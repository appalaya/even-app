/// <reference types="node" />
/**
 * The engine suite runs every test against both stores: the in-memory fake (fakeStore.ts) and the real one
 * (sqliteStore.ts on node:sqlite). Both are wrapped identically so a test cannot tell them apart except by what
 * they store:
 * - `calls` records every method name in call order, including calls on a `transaction`'s `tx` and on
 *   `pendingDeletes` (as `pendingDeletes.add` …);
 * - `fault` runs before every call with its arguments and may throw, to simulate a storage failure (a throw inside
 *   a transaction rolls it back, on both);
 * - `dump` returns every row of a group in insertion order.
 * Node only: it imports node:sqlite through nodeDriver.ts.
 */
import type { SqlDriver } from '../storage/driver';
import { openNodeDriver } from '../storage/nodeDriver';
import { openSqliteStore } from '../storage/sqliteStore';
import type { EventRow, EventOrigin, EventStatus, PushState, Store } from '../storage/types';
import { createFakeStore } from './fakeStore';

export type StoreKind = 'fake' | 'sqlite';
export const STORE_KINDS: readonly StoreKind[] = ['fake', 'sqlite'];

export type FaultHook = (method: string, args: readonly unknown[]) => void;

export interface TestStore extends Store {
  readonly kind: StoreKind;
  /** Method names in call order. */
  readonly calls: string[];
  /** Called before every method; throw from it to simulate a storage failure. */
  fault: FaultHook | null;
  /** Every row of a group, in insertion order. */
  dump(localId: string): Promise<EventRow[]>;
  close(): Promise<void>;
}

interface Hooks {
  calls: string[];
  fault(): FaultHook | null;
}

/** Wraps `store` (and every `tx` it hands out) so each call is recorded and passes the fault hook first. */
function instrument(store: Store, hooks: Hooks): Store {
  const enter = (method: string, args: readonly unknown[]): void => {
    hooks.calls.push(method);
    hooks.fault()?.(method, args);
  };
  const pendingDeletes: Store['pendingDeletes'] = {
    add: async (entry) => {
      enter('pendingDeletes.add', [entry]);
      return store.pendingDeletes.add(entry);
    },
    list: async () => {
      enter('pendingDeletes.list', []);
      return store.pendingDeletes.list();
    },
    remove: async (entry) => {
      enter('pendingDeletes.remove', [entry]);
      return store.pendingDeletes.remove(entry);
    },
    recordAttempt: async (entry) => {
      enter('pendingDeletes.recordAttempt', [entry]);
      return store.pendingDeletes.recordAttempt(entry);
    },
  };
  return new Proxy(store, {
    get(target, property) {
      if (property === 'pendingDeletes') return pendingDeletes;
      if (property === 'transaction') {
        return async <T>(fn: (tx: Store) => Promise<T>): Promise<T> => {
          enter('transaction', []);
          return target.transaction((tx) => fn(instrument(tx, hooks)));
        };
      }
      const value: unknown = Reflect.get(target, property, target);
      if (typeof value !== 'function') return value;
      // async, so a throwing fault surfaces as a rejection, as a storage failure would.
      return async (...args: unknown[]) => {
        enter(String(property), args);
        return (value as (...a: unknown[]) => unknown).apply(target, args);
      };
    },
  });
}

interface RawEvent {
  local_id: string;
  id: string;
  origin: string;
  acked: number;
  seq: number | null;
  ts: number | null;
  envelope: string;
  status: string;
  push_state: string;
  received_at: number | null;
}

async function dumpSqlite(driver: SqlDriver, localId: string): Promise<EventRow[]> {
  const rows = await driver.all<RawEvent>(
    `SELECT local_id, id, origin, acked, seq, ts, envelope, status, push_state, received_at
     FROM events WHERE local_id = ? ORDER BY rowid`,
    [localId],
  );
  return rows.map((r) => ({
    localId: r.local_id,
    id: r.id,
    origin: r.origin as EventOrigin,
    acked: r.acked === 1,
    seq: r.seq,
    ts: r.ts,
    envelope: r.envelope,
    status: r.status as EventStatus,
    pushState: r.push_state as PushState,
    receivedAt: r.received_at,
  }));
}

export async function openTestStore(kind: StoreKind): Promise<TestStore> {
  const calls: string[] = [];
  let fault: FaultHook | null = null;
  let inner: Store;
  let dump: (localId: string) => Promise<EventRow[]>;
  let close: () => Promise<void>;
  if (kind === 'fake') {
    const fake = createFakeStore();
    inner = fake;
    dump = async (localId) => fake.dump(localId);
    close = async () => undefined;
  } else {
    const driver = openNodeDriver();
    const real = await openSqliteStore(driver);
    inner = real;
    dump = (localId) => dumpSqlite(driver, localId);
    close = () => real.close();
  }
  const store = instrument(inner, { calls, fault: () => fault });
  const extras = {
    kind,
    calls,
    dump,
    close,
    get fault() {
      return fault;
    },
    set fault(hook: FaultHook | null) {
      fault = hook;
    },
  };
  return new Proxy(store, {
    get(target, property) {
      return property in extras
        ? Reflect.get(extras, property)
        : Reflect.get(target, property, target);
    },
    set(target, property, value) {
      if (property === 'fault') {
        fault = value as FaultHook | null;
        return true;
      }
      return Reflect.set(target, property, value);
    },
  }) as TestStore;
}
