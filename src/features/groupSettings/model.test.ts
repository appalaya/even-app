import type { GroupState, MemberState } from '@even/core';
import { describe, expect, it } from 'vitest';

import type { GroupUsage } from '../../services/sync/usage';
import type { ServerInfo } from '../../services/sync/types';
import {
  formatBytes,
  groupAgainstLabel,
  hostOf,
  limitsLabel,
  linkForDisplay,
  memberActions,
  memberRows,
  memberStatus,
  meterFill,
  operatorLabel,
  removableMembers,
  retentionLabel,
  usageLabel,
  usagePercent,
  usageWarning,
} from './model';

function member(id: string, name: string, extra: Partial<MemberState> = {}): MemberState {
  return {
    id,
    name,
    archived: false,
    devices: [],
    unknown: false,
    color: 0,
    initials: name.slice(0, 1),
    ...extra,
  };
}

function stateOf(...members: MemberState[]): GroupState {
  return { members: new Map(members.map((m) => [m.id, m])) } as unknown as GroupState;
}

const sam = member('sam', 'Sam', { devices: ['devSam'] });
const maya = member('maya', 'Maya', { devices: ['devMaya1', 'devMaya2'] });
const jordan = member('jordan', 'Jordan', { devices: ['devJordan'], emoji: '🏂' });
const nathan = member('nathan', 'Nathan');

describe('who may edit a member', () => {
  it('your own seat: rename and avatar, never archive', () => {
    expect(memberActions(sam, 'sam')).toEqual(['rename', 'avatar']);
  });

  it('a name nobody has claimed: rename, avatar and archive', () => {
    expect(memberActions(nathan, 'sam')).toEqual(['rename', 'avatar', 'archive']);
  });

  it('another joined member: archive only', () => {
    expect(memberActions(maya, 'sam')).toEqual(['archive']);
    expect(memberActions(jordan, 'sam')).toEqual(['archive']);
  });

  it('an archived member: unarchive only, claimed or not', () => {
    expect(memberActions({ ...maya, archived: true }, 'sam')).toEqual(['unarchive']);
    expect(memberActions({ ...nathan, archived: true }, 'sam')).toEqual(['unarchive']);
  });

  it('before you pick your name, every joined member is someone else', () => {
    expect(memberActions(sam, null)).toEqual(['archive']);
  });
});

describe('member status line', () => {
  it('reads as the board draws it', () => {
    expect(memberStatus(sam, 'sam')).toEqual({ joined: true, label: 'joined · this phone' });
    expect(memberStatus(maya, 'sam')).toEqual({ joined: true, label: 'joined · 2 devices' });
    expect(memberStatus(jordan, 'sam')).toEqual({ joined: true, label: 'joined' });
    expect(memberStatus(nathan, 'sam')).toEqual({ joined: false, label: 'not joined yet' });
    expect(memberStatus({ ...jordan, archived: true }, 'sam')).toEqual({
      joined: false,
      label: 'archived · still in past expenses',
    });
  });
});

describe('member rows', () => {
  it('you first, then the others in the order they were added, then archived ones; no placeholders', () => {
    const ghost = member('ghost', 'Unknown', { unknown: true });
    const gone = member('gone', 'Priya', { archived: true, devices: ['devPriya'] });
    const rows = memberRows(stateOf(maya, gone, jordan, sam, ghost, nathan), 'sam');
    expect(rows.map((r) => r.member.id)).toEqual(['sam', 'maya', 'jordan', 'nathan', 'gone']);
    expect(rows.map((r) => r.isMe)).toEqual([true, false, false, false, false]);
    expect(rows[4]?.actions).toEqual(['unarchive']);
  });

  it('"Remove someone?" offers everyone but you who is not archived', () => {
    const gone = member('gone', 'Priya', { archived: true });
    const ids = removableMembers(stateOf(sam, maya, gone, jordan, nathan), 'sam').map((m) => m.id);
    expect(ids).toEqual(['maya', 'jordan', 'nathan']);
  });
});

const INFO: ServerInfo = {
  protocol: [1],
  limits: {
    max_event_bytes: 8192,
    max_group_bytes: 2_097_152,
    max_group_events: 10_000,
    max_batch: 25,
    max_page: 500,
    daily_write_budget: 0,
    rate: { requests_per_minute: 120, writes_per_minute: 60, group_creates_per_minute: 3 },
  },
  retention_days: 365,
  push: false,
  operator: 'Even (appalaya.com)',
};

function usage(bytes: number, events: number): GroupUsage {
  const bytesFraction = bytes / 2_097_152;
  const eventsFraction = events / 10_000;
  const fraction = Math.max(bytesFraction, eventsFraction);
  return {
    bytes,
    events,
    maxBytes: 2_097_152,
    maxEvents: 10_000,
    bytesFraction,
    eventsFraction,
    fraction,
    warn: fraction >= 0.8,
  };
}

describe('server labels', () => {
  it('limits and retention read as drawn', () => {
    expect(limitsLabel(INFO, 'en-US')).toBe('2 MB · 10,000 entries');
    expect(retentionLabel(365)).toBe('365 days after last change');
    expect(retentionLabel(1)).toBe('1 day after last change');
  });

  it('sizes are binary: KB below a megabyte, one decimal at most above', () => {
    expect(formatBytes(0, 'en-US')).toBe('0 KB');
    expect(formatBytes(246 * 1024, 'en-US')).toBe('246 KB');
    expect(formatBytes(2_097_152, 'en-US')).toBe('2 MB');
    expect(formatBytes(1.5 * 1024 * 1024, 'en-US')).toBe('1.5 MB');
  });

  it('usage reads "246 KB of 2 MB · 12%" and the meter fills to the larger fraction', () => {
    const u = usage(246 * 1024, 700);
    expect(usageLabel(u, 'en-US')).toBe('246 KB of 2 MB · 12%');
    expect(meterFill(u)).toBeCloseTo(0.12, 2);
  });

  it('counts entries when entries are the tighter cap', () => {
    expect(usageLabel(usage(100 * 1024, 8_100), 'en-US')).toBe('8,100 of 10,000 entries · 81%');
  });

  it('rounds as the boards do, never reads 100% before the group is full; the meter stops at full', () => {
    expect(usagePercent((246 * 1024) / 5_242_880)).toBe(5);
    expect(usagePercent(0.996)).toBe(99);
    expect(usagePercent(1)).toBe(100);
    expect(meterFill(usage(3_000_000, 0))).toBe(1);
  });

  it('warns from 80% and words a full group (extra states)', () => {
    expect(usageWarning(usage(246 * 1024, 700))).toBeNull();
    expect(usageWarning(usage(1.7 * 1024 * 1024, 700))).toBe(
      'This group is near its server limit. Export it and start a new one for the next trip.',
    );
    expect(usageWarning(usage(2_097_152, 700))).toBe(
      'This group is full. New entries stay on this phone. Export it and start a new one.',
    );
    expect(usageLabel(usage(1.7 * 1024 * 1024, 700), 'en-US')).toBe('1.7 MB of 2 MB · 85%');
  });

  it('names the operator, or "Self-hosted", and a group against another server', () => {
    expect(operatorLabel(INFO)).toBe('Even (appalaya.com)');
    expect(operatorLabel({ ...INFO, operator: undefined })).toBe('Self-hosted');
    const five = {
      ...usage(246 * 1024, 700),
      fraction: 0.05,
      bytesFraction: 0.05,
      eventsFraction: 0.014,
    };
    expect(groupAgainstLabel(five, 'en-US')).toBe('246 KB · 5% of the limit');
  });

  it('host and link drop the scheme', () => {
    expect(hostOf('https://sync.even.appalaya.com')).toBe('sync.even.appalaya.com');
    expect(linkForDisplay('https://even.appalaya.com/i#eyJ2')).toBe('even.appalaya.com/i#eyJ2');
  });
});
