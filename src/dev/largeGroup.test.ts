import { parseEvent, reduce } from '@even/core';
import { describe, expect, it } from 'vitest';

import { largeGroup } from './largeGroup';

describe('largeGroup', () => {
  const end = Date.UTC(2026, 9, 1);
  const group = largeGroup({ events: 2_000, end });

  it('is the size asked for, every event valid, in ts order up to `end`', () => {
    expect(group.entries).toHaveLength(2_000);
    for (const { event } of group.entries) expect(parseEvent(event)).not.toBeNull();
    const ts = group.entries.map((e) => e.event.ts);
    expect([...ts].sort((a, b) => a - b)).toEqual(ts);
    expect(ts.at(-1)).toBe(end);
  });

  it("has the review's mix: 50 claimed members, mostly expenses, then edits, payments and deletes", () => {
    const state = reduce(group.entries);
    expect([...state.members.values()].filter((m) => m.devices.length > 0)).toHaveLength(50);
    expect(group.counts['expense.added']).toBeGreaterThan(1_200);
    expect(group.counts['expense.updated']).toBeGreaterThan(300);
    expect(group.counts['payment.added']).toBeGreaterThan(50);
    expect(group.counts['expense.deleted']).toBeGreaterThan(10);
    expect(state.expenses.size).toBe(
      (group.counts['expense.added'] ?? 0) - (group.counts['expense.deleted'] ?? 0),
    );
    expect(state.flagged).toEqual([]);
  });

  it('is the same log for the same seed', () => {
    expect(largeGroup({ events: 2_000, end }).entries).toEqual(group.entries);
  });
});
