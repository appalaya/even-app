/**
 * "Last notified" lives in the store's `prefs` table (`notifications.ledger`), on both stores: it round-trips, reads
 * back empty when absent or damaged, and an empty ledger clears the row.
 */
import { afterEach, describe, expect, it } from 'vitest';

import { openTestStore, STORE_KINDS, type TestStore } from '../testing/testStore';
import { nextLedger, prefsLedger, type PlannedNotification } from './coalesce';

const opened: TestStore[] = [];
afterEach(async () => {
  await Promise.all(opened.splice(0).map((s) => s.close()));
});

const plan = (localId: string, count: number): PlannedNotification => ({
  localId,
  identifier: `activity:${localId}`,
  title: 'Banff 2026',
  body: `${count} new changes`,
  count,
});

describe.each(STORE_KINDS)('the notification ledger in prefs on the %s store', (kind) => {
  async function store() {
    const s = await openTestStore(kind);
    opened.push(s);
    return s;
  }

  it('round-trips through the prefs row and clears it when empty', async () => {
    const s = await store();
    const ledger = prefsLedger(s);
    expect(await ledger.read()).toEqual({});
    await ledger.write(
      nextLedger({}, [plan('g1', 2), plan('g2', 1)], 1_000, new Set(['g1', 'g2'])),
    );
    expect(await ledger.read()).toEqual({
      g1: { at: 1_000, count: 2 },
      g2: { at: 1_000, count: 1 },
    });
    expect(JSON.parse((await s.getPref('notifications.ledger')) ?? 'null')).toEqual({
      g1: { at: 1_000, count: 2 },
      g2: { at: 1_000, count: 1 },
    });
    // A group that left this phone drops out on the next write.
    await ledger.write(nextLedger(await ledger.read(), [], 2_000, new Set(['g2'])));
    expect(await ledger.read()).toEqual({ g2: { at: 1_000, count: 1 } });
    await ledger.write({});
    expect(await s.getPref('notifications.ledger')).toBeNull();
  });

  it('reads a damaged row as empty', async () => {
    const s = await store();
    await s.setPref('notifications.ledger', '{not json');
    expect(await prefsLedger(s).read()).toEqual({});
    await s.setPref('notifications.ledger', JSON.stringify({ g1: { at: 'x', count: 1 } }));
    expect(await prefsLedger(s).read()).toEqual({});
  });
});
