import * as fc from 'fast-check';
import { describe, expect, it } from 'vitest';

import { AVATAR_STACK_MAX, stackLayout } from '../avatarStackLogic';

const m = (id: string, done: boolean) => ({ id, done });
const ids = (xs: readonly { id: string }[]) => xs.map((x) => x.id);

describe('stackLayout', () => {
  it('puts members still adding (outlined) before members who are done (filled), as Group draws', () => {
    // Group board: Sam still adding; Maya, Jordan and Nathan done. Input order has Sam last.
    const { shown, overflow } = stackLayout([
      m('maya', true),
      m('jordan', true),
      m('nathan', true),
      m('sam', false),
    ]);
    expect(ids(shown)).toEqual(['sam', 'maya', 'jordan', 'nathan']);
    expect(overflow).toBe(0);
  });

  it('keeps the caller order within each half', () => {
    const { shown } = stackLayout([m('a', true), m('b', false), m('c', true), m('d', false)]);
    expect(ids(shown)).toEqual(['b', 'd', 'a', 'c']);
  });

  it('draws at most five, then counts the rest (twelve members: five still adding, then +7)', () => {
    const members = [
      ...['d1', 'd2', 'd3', 'd4', 'd5', 'd6', 'd7'].map((id) => m(id, true)),
      ...['sam', 'priya', 'leo', 'ben', 'diego'].map((id) => m(id, false)),
    ];
    const { shown, overflow } = stackLayout(members);
    expect(AVATAR_STACK_MAX).toBe(5);
    expect(ids(shown)).toEqual(['sam', 'priya', 'leo', 'ben', 'diego']);
    expect(overflow).toBe(7);
  });

  it('fills the five with done members once everyone still adding is shown', () => {
    const { shown, overflow } = stackLayout([
      m('a', true),
      m('b', true),
      m('c', false),
      m('d', true),
      m('e', true),
      m('f', true),
    ]);
    expect(ids(shown)).toEqual(['c', 'a', 'b', 'd', 'e']);
    expect(overflow).toBe(1);
  });

  it('handles no members, and a custom or degenerate max', () => {
    expect(stackLayout([])).toEqual({ shown: [], overflow: 0 });
    expect(ids(stackLayout([m('a', true), m('b', false)], 1).shown)).toEqual(['b']);
    expect(stackLayout([m('a', true), m('b', false)], 0)).toEqual({ shown: [], overflow: 2 });
    expect(stackLayout([m('a', true)], -3)).toEqual({ shown: [], overflow: 1 });
  });

  it('never loses or duplicates a member, and never draws a done member before one still adding', () => {
    fc.assert(
      fc.property(
        fc.array(fc.boolean(), { maxLength: 40 }),
        fc.integer({ min: 0, max: 12 }),
        (flags, max) => {
          const members = flags.map((done, i) => m(`m${i}`, done));
          const { shown, overflow } = stackLayout(members, max);
          expect(shown.length).toBe(Math.min(max, members.length));
          expect(shown.length + overflow).toBe(members.length);
          expect(new Set(ids(shown)).size).toBe(shown.length);
          const firstDone = shown.findIndex((x) => x.done);
          if (firstDone >= 0) expect(shown.slice(firstDone).every((x) => x.done)).toBe(true);
          // Everyone still adding is shown before any done member is.
          const notDone = members.filter((x) => !x.done).length;
          if (shown.some((x) => x.done)) expect(shown.filter((x) => !x.done).length).toBe(notDone);
        },
      ),
    );
  });
});
