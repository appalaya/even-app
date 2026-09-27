import { describe, expect, it } from 'vitest';

import {
  activityIdentifier,
  nextLedger,
  parseLedger,
  planGroupNotification,
  type ActivityLine,
  type GroupActivityInput,
} from './coalesce';

const ME = 'devMe';
const HISTORY: ActivityLine[] = [
  { eventId: 'e1', dev: ME, summary: 'Sam joined' },
  { eventId: 'e2', dev: ME, summary: 'Sam created the group' },
  { eventId: 'e3', dev: 'devMaya', summary: 'Maya joined' },
];

function input(extra: ActivityLine[], newOkIds: string[], shown: number | null = null) {
  return {
    localId: 'g1',
    groupName: 'Banff 2026',
    deviceId: ME,
    activity: [...HISTORY, ...extra],
    newOkIds,
    shown: shown === null ? null : { count: shown },
  } satisfies GroupActivityInput;
}

const dinner: ActivityLine = {
  eventId: 'n1',
  dev: 'devMaya',
  summary: 'Maya added Dinner · $90.00',
};
const taxi: ActivityLine = {
  eventId: 'n2',
  dev: 'devJordan',
  summary: 'Jordan added Taxi · $24.00',
};
const mine: ActivityLine = { eventId: 'n3', dev: ME, summary: 'Sam added Gas · $40.00' };

describe('planGroupNotification', () => {
  it('one new event from another device: the group name over its activity summary', () => {
    expect(planGroupNotification(input([dinner], ['n1']))).toEqual({
      localId: 'g1',
      identifier: activityIdentifier('g1'),
      title: 'Banff 2026',
      body: 'Maya added Dinner · $90.00',
      count: 1,
    });
  });

  it('several: coalesced into "N new changes", under the group name as the title', () => {
    const plan = planGroupNotification(input([dinner, taxi], ['n1', 'n2']));
    expect(plan?.title).toBe('Banff 2026');
    expect(plan?.body).toBe('2 new changes');
    expect(plan?.count).toBe(2);
  });

  it("this device's own events are never announced", () => {
    expect(planGroupNotification(input([mine], ['n3']))).toBeNull();
    expect(planGroupNotification(input([dinner, mine], ['n1', 'n3']))?.body).toBe(
      'Maya added Dinner · $90.00',
    );
  });

  it('only events this cycle inserted count, not ones already on this phone', () => {
    expect(planGroupNotification(input([dinner, taxi], ['n2']))?.body).toBe(
      'Jordan added Taxi · $24.00',
    );
    expect(planGroupNotification(input([dinner], []))).toBeNull();
  });

  it('a first download (the whole log arrived in this cycle) is history, not activity', () => {
    const everything = [...HISTORY, dinner].map((line) => line.eventId);
    expect(planGroupNotification(input([dinner], everything))).toBeNull();
  });

  it('ids that are not applied events (skipped by the reducer) are ignored', () => {
    expect(planGroupNotification(input([], ['nope']))).toBeNull();
  });

  it('replaces a notification still showing, carrying its count', () => {
    expect(planGroupNotification(input([dinner], ['n1'], 2))?.body).toBe('3 new changes');
    expect(planGroupNotification(input([dinner], ['n1'], 2))?.count).toBe(3);
  });
});

describe('the ledger', () => {
  it('reads what it wrote, and anything malformed as empty', () => {
    expect(parseLedger(JSON.stringify({ g1: { at: 5, count: 2 } }))).toEqual({
      g1: { at: 5, count: 2 },
    });
    expect(parseLedger(null)).toEqual({});
    expect(parseLedger('{')).toEqual({});
    expect(parseLedger('[1]')).toEqual({});
    expect(
      parseLedger(JSON.stringify({ g1: { at: 'x', count: 2 }, g2: { at: 1, count: 0 } })),
    ).toEqual({});
  });

  it('records each posted notification and forgets groups that left the phone', () => {
    const plan = planGroupNotification(input([dinner], ['n1']));
    if (plan === null) throw new Error('expected a plan');
    const ledger = nextLedger(
      { gone: { at: 1, count: 1 }, g2: { at: 2, count: 4 } },
      [plan],
      99,
      new Set(['g1', 'g2']),
    );
    expect(ledger).toEqual({ g1: { at: 99, count: 1 }, g2: { at: 2, count: 4 } });
  });
});
