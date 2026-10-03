/**
 * In-memory Even server (PROTOCOL.md §4–§7) behind the `Transport` interface, for the sync engine's tests.
 * Faithful where the engine depends on it: stateless token auth, implicit creation with a fresh epoch, atomic
 * consecutive `seq`, `received_at` (one value per request that stores something, from the server's clock, strictly
 * increasing across requests; reported per envelope on push, a duplicate reporting its stored value, and on every
 * pulled envelope), duplicates ignored and counted (within and across requests), whole-batch rejection with
 * `index` (400 before 415), both caps with duplicates exempt, `since`/`limit` clamping, `next`/`more`, the
 * missing-group-is-empty rule, DELETE then a new epoch, and `410` for blocked ids.
 *
 * Scripting for failure paths: `failNext` queues error answers per operation, `onRequest` runs before every
 * request (mutate state there, e.g. `wipe` to lose the group or `setEpoch` to flip it), `injectRaw` stores
 * arbitrary objects so pulls can return junk, `requests` records every call, `legacy` answers as a server from
 * before `received_at`, and `arrival` overrides the R a request assigns (a hostile server's choice).
 */
/// <reference types="node" />
import { createHash } from 'node:crypto';

import { envelopeShape, envelopeStoredSize, newId, type Envelope } from '@even/core';

import { SyncError, type SyncErrorDetails } from '../sync/errors';
import type {
  PullResponse,
  PushResponse,
  ServerInfo,
  StoredEnvelope,
  SyncErrorCode,
  Transport,
} from '../sync/types';

export type FakeOp = 'info' | 'push' | 'pull' | 'delete';

export interface FakeRequest {
  op: FakeOp;
  groupId?: string;
  /** push: envelope ids in the request. */
  ids?: string[];
  since?: number;
  limit?: number;
}

export interface ScriptedFailure {
  code: SyncErrorCode;
  status?: number;
  index?: number;
  reason?: 'bytes' | 'events';
  retryAfterMs?: number;
  /** The error's message, as if a transport had passed on the server's words (the real one never does). */
  message?: string;
}

interface FakeGroup {
  epoch: string;
  seq: number;
  /** The last `received_at` this epoch assigned; the next request's is above it. */
  lastArrival: number;
  bytes: number;
  /** Stored entries: real envelopes, or raw junk from `injectRaw`. */
  events: ({ seq: number; id: string } & Record<string, unknown>)[];
  ids: Set<string>;
}

export const FAKE_LIMITS: ServerInfo['limits'] = {
  max_event_bytes: 8192,
  max_group_bytes: 2_097_152,
  max_group_events: 10_000,
  max_batch: 25,
  max_page: 500,
  daily_write_budget: 0,
  rate: { requests_per_minute: 120, writes_per_minute: 60, group_creates_per_minute: 3 },
};

const DEFAULT_STATUS: Partial<Record<SyncErrorCode, number>> = {
  invalid_request: 400,
  invalid_envelope: 400,
  unauthorized: 401,
  group_full: 413,
  unsupported_version: 415,
  group_blocked: 410,
  rate_limited: 429,
  over_budget: 503,
  server_error: 500,
  not_an_even_server: 404,
};

function fail(code: SyncErrorCode, details: SyncErrorDetails = {}, message?: string): SyncError {
  const status = details.status ?? DEFAULT_STATUS[code];
  return new SyncError(
    code,
    message ?? `fake server: ${code}`,
    status === undefined ? details : { ...details, status },
  );
}

export class FakeServer {
  info: ServerInfo;
  readonly groups = new Map<string, FakeGroup>();
  readonly blocked = new Set<string>();
  readonly requests: FakeRequest[] = [];
  /** Runs before every request, after it is logged and before scripted failures. */
  onRequest: ((request: FakeRequest) => void) | null = null;
  private script: { op: FakeOp | 'any'; failure: ScriptedFailure }[] = [];
  /** Answer every request with a network error while true. */
  offline = false;
  /** Answer as a server from before `received_at` (PROTOCOL.md §4): none on push responses or pulled envelopes. */
  legacy = false;
  /** How far this server's clock runs from the clock it was given (negative: behind); its R follows it. */
  clockSkewMs = 0;
  /** When set, the `received_at` a storing request assigns, instead of the clock's (a hostile server's choice). */
  arrival: ((groupId: string) => unknown) | null = null;
  private gateOpen: Promise<void> | null = null;
  private readonly clock: () => number;

  constructor(limits: Partial<ServerInfo['limits']> = {}, now: () => number = Date.now) {
    this.clock = now;
    this.info = {
      protocol: [1],
      limits: { ...FAKE_LIMITS, ...limits },
      retention_days: 365,
      push: false,
      operator: 'Fake',
    };
  }

  /** Holds every request until the returned function is called, so a test can act while a cycle is in flight. */
  hold(): () => void {
    let release!: () => void;
    this.gateOpen = new Promise<void>((resolve) => {
      release = resolve;
    });
    return () => {
      this.gateOpen = null;
      release();
    };
  }

  /** Queues `times` failures for the next requests of `op` (or any op). */
  failNext(op: FakeOp | 'any', failure: ScriptedFailure, times = 1): this {
    for (let i = 0; i < times; i++) this.script.push({ op, failure });
    return this;
  }

  /** The server loses the group (expiry, operator delete): the next write recreates it with a new epoch. */
  wipe(groupId: string): void {
    this.groups.delete(groupId);
  }

  /** Flips the epoch while keeping the data: a misbehaving server, for the "changed twice" rule. */
  setEpoch(groupId: string, epoch = newId()): void {
    const group = this.groups.get(groupId);
    if (group !== undefined) group.epoch = epoch;
  }

  /** Appends an arbitrary object as the next stored entry, bypassing validation (a non-conforming server). */
  injectRaw<T extends { id: string }>(groupId: string, raw: T): number {
    const group = this.ensureGroup(groupId);
    group.seq += 1;
    group.events.push({ ...raw, seq: group.seq });
    group.ids.add(raw.id);
    return group.seq;
  }

  /** Every stored id's `received_at` in a group, in seq order, for assertions. */
  receivedAt(groupId: string): Map<string, unknown> {
    return new Map((this.groups.get(groupId)?.events ?? []).map((e) => [e.id, e.received_at]));
  }

  /** Stored entries of a group (with `seq`), for assertions. */
  stored(groupId: string): StoredEnvelope[] {
    return (this.groups.get(groupId)?.events ?? []).map(
      (e) => ({ ...e }) as unknown as StoredEnvelope,
    );
  }

  /** Push batch sizes in order, for assertions. */
  pushSizes(): number[] {
    return this.requests.filter((r) => r.op === 'push').map((r) => r.ids?.length ?? 0);
  }

  transport(): Transport {
    return {
      info: async () => {
        await this.gateOpen;
        this.begin({ op: 'info' });
        return structuredClone(this.info);
      },
      push: async (groupId, token, envelopes) => {
        await this.gateOpen;
        this.begin({ op: 'push', groupId, ids: envelopes.map((e) => String(e?.id)) });
        return this.push(groupId, token, envelopes);
      },
      pull: async (groupId, token, since, limit) => {
        await this.gateOpen;
        this.begin({ op: 'pull', groupId, since, limit });
        return this.pull(groupId, token, since, limit);
      },
      delete: async (groupId, token) => {
        await this.gateOpen;
        this.begin({ op: 'delete', groupId });
        this.gate(groupId, token);
        this.groups.delete(groupId);
      },
    };
  }

  private begin(request: FakeRequest): void {
    this.requests.push(request);
    if (this.offline) throw new SyncError('network', 'fake server: offline');
    this.onRequest?.(request);
    const i = this.script.findIndex((s) => s.op === request.op || s.op === 'any');
    const scripted = i === -1 ? undefined : this.script.splice(i, 1)[0];
    if (scripted !== undefined) {
      const { code, message, ...details } = scripted.failure;
      throw fail(code, details, message);
    }
  }

  /** Auth, then the blocklist (PROTOCOL.md §7: 401 before 410). */
  private gate(groupId: string, token: Uint8Array): void {
    const hash = createHash('sha256').update(token).digest('base64url');
    if (hash !== groupId) throw fail('unauthorized');
    if (this.blocked.has(groupId)) throw fail('group_blocked');
  }

  private ensureGroup(groupId: string): FakeGroup {
    let group = this.groups.get(groupId);
    if (group === undefined) {
      group = { epoch: newId(), seq: 0, lastArrival: 0, bytes: 0, events: [], ids: new Set() };
      this.groups.set(groupId, group);
    }
    return group;
  }

  private push(groupId: string, token: Uint8Array, envelopes: Envelope[]): PushResponse {
    this.gate(groupId, token);
    const { max_batch, max_event_bytes, max_group_bytes, max_group_events } = this.info.limits;
    if (!Array.isArray(envelopes) || envelopes.length < 1 || envelopes.length > max_batch) {
      throw fail('invalid_request');
    }
    // Structural errors first across the whole batch, then versions (400 before 415).
    const shapes = envelopes.map((e) => envelopeShape(e));
    const tooBig = (e: Envelope) => Math.floor((e.c.length * 3) / 4) > max_event_bytes;
    const bad = shapes.findIndex((s, i) => !s.ok || tooBig(envelopes[i] as Envelope));
    if (bad !== -1) throw fail('invalid_envelope', { index: bad });
    const unsupported = shapes.findIndex((s) => s.ok && s.v !== 1);
    if (unsupported !== -1) throw fail('unsupported_version', { index: unsupported });

    const existing = this.groups.get(groupId);
    const known = existing?.ids ?? new Set<string>();
    const fresh: Envelope[] = [];
    const seen = new Set<string>();
    for (const envelope of envelopes) {
      if (known.has(envelope.id) || seen.has(envelope.id)) continue;
      seen.add(envelope.id);
      fresh.push(envelope);
    }
    const addBytes = fresh.reduce((sum, e) => sum + envelopeStoredSize(e), 0);
    const bytes = (existing?.bytes ?? 0) + addBytes;
    const count = (existing?.events.length ?? 0) + fresh.length;
    if (bytes > max_group_bytes) throw fail('group_full', { reason: 'bytes' });
    if (count > max_group_events) throw fail('group_full', { reason: 'events' });

    const group = this.ensureGroup(groupId);
    // One R per request that stores something: the clock, kept strictly above the epoch's last one.
    let arrival: unknown = group.lastArrival;
    if (fresh.length > 0) {
      const assigned = Math.max(this.clock() + this.clockSkewMs, group.lastArrival + 1);
      group.lastArrival = assigned;
      arrival = this.arrival === null ? assigned : this.arrival(groupId);
    }
    for (const envelope of fresh) {
      group.seq += 1;
      group.events.push({
        id: envelope.id,
        v: envelope.v,
        n: envelope.n,
        c: envelope.c,
        seq: group.seq,
        received_at: arrival,
      });
      group.ids.add(envelope.id);
    }
    group.bytes += addBytes;
    const response: PushResponse = {
      accepted: fresh.length,
      duplicates: envelopes.length - fresh.length,
      seq: group.seq,
      epoch: group.epoch,
    };
    if (!this.legacy) {
      const stored = new Map(group.events.map((e) => [e.id, e.received_at]));
      response.received_at = envelopes.map((e) => stored.get(e.id));
    }
    return response;
  }

  private pull(groupId: string, token: Uint8Array, since: number, limit: number): PullResponse {
    this.gate(groupId, token);
    if (!Number.isSafeInteger(since) || since < 0 || !Number.isSafeInteger(limit) || limit < 1) {
      throw fail('invalid_request');
    }
    const group = this.groups.get(groupId);
    if (group === undefined) return { events: [], next: since, more: false, epoch: null };
    const clamped = Math.min(limit, this.info.limits.max_page);
    const after = group.events.filter((e) => e.seq > since);
    const page = after.slice(0, clamped);
    const next = page.length > 0 ? (page[page.length - 1]?.seq ?? since) : since;
    return {
      events: page.map((e) => {
        const copy: Record<string, unknown> = { ...e };
        if (this.legacy || copy.received_at === undefined) delete copy.received_at;
        return copy as unknown as StoredEnvelope;
      }),
      next,
      more: after.length > page.length,
      epoch: group.epoch,
    };
  }
}
