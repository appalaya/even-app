/**
 * Model-based check: random sequences of inserts (local and pulled, with duplicates), acks, rejections and
 * resets, applied to the store and to a plain in-memory model of design.md's rules. After every step the
 * outbox must equal the model's `acked = 0 AND push_state = 'pending'` rows in log order, and acked/seq/
 * push_state must match row by row.
 */
import * as fc from 'fast-check';
import { describe, expect, it } from 'vitest';

import { openNodeDriver } from './nodeDriver';
import { openSqliteStore } from './sqliteStore';
import { localRow, makeGroup, pulledRow } from './testFixtures';
import type { NewEventRow } from './types';

const T0 = 1_760_000_000_000;
/** A small id pool so duplicates and ts ties are common. */
const IDS = Array.from({ length: 10 }, (_, i) => String.fromCharCode(65 + i).repeat(22));

interface ModelRow {
  acked: boolean;
  seq: number | null;
  ts: number | null;
  pushState: 'pending' | 'rejected';
}

type Op =
  | {
      kind: 'insert';
      rows: {
        idx: number;
        acked: boolean;
        seq: number | null;
        ts: number | null;
        rejected: boolean;
      }[];
    }
  | { kind: 'ack'; idxs: number[] }
  | { kind: 'reject'; idxs: number[] }
  | { kind: 'reset'; clearRejected: boolean };

const idx = fc.integer({ min: 0, max: IDS.length - 1 });
const insertRow = fc.record({
  idx,
  acked: fc.boolean(),
  seq: fc.option(fc.integer({ min: 1, max: 30 }), { nil: null }),
  ts: fc.option(fc.integer({ min: 0, max: 4 }), { nil: null, freq: 4 }),
  rejected: fc.integer({ min: 0, max: 9 }).map((n) => n < 2),
});
const op: fc.Arbitrary<Op> = fc.oneof(
  {
    weight: 4,
    arbitrary: fc.record({
      kind: fc.constant('insert' as const),
      rows: fc.array(insertRow, { minLength: 1, maxLength: 5 }),
    }),
  },
  {
    weight: 2,
    arbitrary: fc.record({
      kind: fc.constant('ack' as const),
      idxs: fc.array(idx, { maxLength: 4 }),
    }),
  },
  {
    weight: 1,
    arbitrary: fc.record({
      kind: fc.constant('reject' as const),
      idxs: fc.array(idx, { maxLength: 2 }),
    }),
  },
  {
    weight: 1,
    arbitrary: fc.record({ kind: fc.constant('reset' as const), clearRejected: fc.boolean() }),
  },
);

function toRow(r: Extract<Op, { kind: 'insert' }>['rows'][number]): NewEventRow {
  const id = IDS[r.idx]!;
  const ts = r.ts === null ? null : T0 + r.ts;
  const base = r.acked ? pulledRow(r.seq ?? 1, ts, { id }) : localRow(ts ?? T0, { id });
  return {
    ...base,
    acked: r.acked,
    seq: r.acked ? r.seq : null,
    ts,
    status: ts === null ? 'undecryptable' : 'ok',
    pushState: r.rejected ? 'rejected' : 'pending',
  };
}

function logOrder(a: [string, ModelRow], b: [string, ModelRow]): number {
  const [ida, ra] = a;
  const [idb, rb] = b;
  if ((ra.ts === null) !== (rb.ts === null)) return ra.ts === null ? 1 : -1;
  if (ra.ts !== rb.ts) return (ra.ts ?? 0) - (rb.ts ?? 0);
  return ida < idb ? -1 : ida > idb ? 1 : 0;
}

describe('outbox model', () => {
  it('matches the model after random operation sequences', async () => {
    await fc.assert(
      fc.asyncProperty(fc.array(op, { minLength: 1, maxLength: 25 }), async (ops) => {
        const driver = openNodeDriver();
        const store = await openSqliteStore(driver);
        try {
          const group = makeGroup();
          const g = group.localId;
          await store.upsertGroup(group);
          const model = new Map<string, ModelRow>();

          for (const o of ops) {
            if (o.kind === 'insert') {
              const rows = o.rows.map(toRow);
              const expected = { inserted: [] as string[], acked: 0 };
              for (const row of rows) {
                const current = model.get(row.id);
                if (!current) {
                  model.set(row.id, {
                    acked: row.acked,
                    seq: row.seq,
                    ts: row.ts,
                    pushState: row.pushState ?? 'pending',
                  });
                  expected.inserted.push(row.id);
                } else if (row.acked) {
                  const seq =
                    row.seq === null
                      ? current.seq
                      : current.seq === null
                        ? row.seq
                        : Math.max(current.seq, row.seq);
                  if (!current.acked || seq !== current.seq) {
                    current.acked = true;
                    current.seq = seq;
                    expected.acked += 1;
                  }
                }
              }
              expect(await store.insertEvents(g, rows)).toEqual(expected);
            } else if (o.kind === 'ack') {
              await store.ack(
                g,
                o.idxs.map((i) => IDS[i]!),
              );
              for (const i of o.idxs) {
                const row = model.get(IDS[i]!);
                if (row) row.acked = true;
              }
            } else if (o.kind === 'reject') {
              await store.markRejected(
                g,
                o.idxs.map((i) => IDS[i]!),
              );
              for (const i of o.idxs) {
                const row = model.get(IDS[i]!);
                if (row) row.pushState = 'rejected';
              }
            } else {
              await store.resetAcked(g, { clearRejected: o.clearRejected });
              for (const row of model.values()) {
                row.acked = false;
                row.seq = null;
                if (o.clearRejected) row.pushState = 'pending';
              }
            }

            const expectedOutbox = [...model]
              .filter(([, r]) => !r.acked && r.pushState === 'pending')
              .sort(logOrder)
              .map(([id]) => id);
            expect((await store.outbox(g, 1_000)).map((r) => r.id)).toEqual(expectedOutbox);

            const counts = await store.countByStatus(g);
            expect(counts.outbox).toBe(expectedOutbox.length);
            expect(counts.rejected).toBe(
              [...model.values()].filter((r) => r.pushState === 'rejected').length,
            );

            const stored = await driver.all<{
              id: string;
              acked: number;
              seq: number | null;
              push_state: string;
            }>('SELECT id, acked, seq, push_state FROM events WHERE local_id = ? ORDER BY id', [g]);
            expect(stored).toEqual(
              [...model]
                .sort(([a], [b]) => (a < b ? -1 : 1))
                .map(([id, r]) => ({
                  id,
                  acked: r.acked ? 1 : 0,
                  seq: r.seq,
                  push_state: r.pushState,
                })),
            );
          }
        } finally {
          await store.close();
        }
      }),
      { numRuns: 200 },
    );
  });
});
