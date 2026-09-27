import type { Category } from '@even/core';
import { describe, expect, it } from 'vitest';

import {
  ChipController,
  chipReducer,
  initialChipState,
  MODEL_PAUSE_MS,
  shouldAskModel,
  SUGGESTED_TAG_MS,
  type ChipState,
} from './chipMachine';

/** A manual scheduler: timers fire only when the test advances time. */
function manualClock() {
  let now = 0;
  const timers: { at: number; fn: () => void; cancelled: boolean }[] = [];
  return {
    schedule(fn: () => void, ms: number) {
      const timer = { at: now + ms, fn, cancelled: false };
      timers.push(timer);
      return () => {
        timer.cancelled = true;
      };
    },
    advance(ms: number) {
      now += ms;
      for (const timer of timers) {
        if (!timer.cancelled && timer.at <= now) {
          timer.cancelled = true;
          timer.fn();
        }
      }
    },
  };
}

/** A fake model whose replies the test resolves by hand, in any order. */
function manualModel() {
  const asked: { title: string; resolve: (c: Category | null) => void }[] = [];
  return {
    asked,
    refine(title: string) {
      return new Promise<Category | null>((resolve) => {
        asked.push({ title, resolve });
      });
    },
    async reply(index: number, category: Category | null) {
      asked[index]?.resolve(category);
      await Promise.resolve();
      await Promise.resolve();
    },
  };
}

function controller(title = '', initial?: ChipState) {
  const clock = manualClock();
  const model = manualModel();
  const chip = new ChipController(title, initial ?? initialChipState(title), {
    refine: (t) => model.refine(t),
    schedule: clock.schedule,
  });
  return { chip, clock, model };
}

describe('chipReducer', () => {
  it('infers from keywords on every keystroke while the source is keyword or model', () => {
    let s = initialChipState('');
    expect(s).toEqual({
      category: 'other',
      source: 'keyword',
      frozen: false,
      swaps: 0,
      tagged: false,
    });
    s = chipReducer(s, { type: 'title', title: 'Lake Louise shuttle' });
    expect(s.category).toBe('transit');
    s = chipReducer(s, {
      type: 'reply',
      askedTitle: 'Lake Louise shuttle',
      currentTitle: 'Lake Louise shuttle',
      category: 'activities',
    });
    expect(s).toMatchObject({ category: 'activities', source: 'model', swaps: 1 });
    // A keystroke after a model suggestion re-infers from the table (design.md: source ≠ user).
    s = chipReducer(s, { type: 'title', title: 'Lake Louise shuttle bus' });
    expect(s).toMatchObject({ category: 'transit', source: 'keyword' });
  });

  it('never tags a keyword-inferred chip; tags a model change until untagged', () => {
    let s = chipReducer(initialChipState(''), { type: 'title', title: 'Lake Louise shuttle' });
    expect(s).toMatchObject({ category: 'transit', source: 'keyword', tagged: false });
    s = chipReducer(s, {
      type: 'reply',
      askedTitle: 'Lake Louise shuttle',
      currentTitle: 'Lake Louise shuttle',
      category: 'activities',
    });
    expect(s).toMatchObject({ category: 'activities', source: 'model', swaps: 1, tagged: true });
    // An untag for an older change leaves a newer tag alone; the current one clears it.
    expect(chipReducer(s, { type: 'untag', swap: 0 })).toBe(s);
    expect(chipReducer(s, { type: 'untag', swap: 1 })).toMatchObject({ tagged: false });
  });

  it('a model reply that agrees with the chip does not tag it', () => {
    const s = chipReducer(initialChipState(''), { type: 'title', title: 'Taxi' });
    const next = chipReducer(s, {
      type: 'reply',
      askedTitle: 'Taxi',
      currentTitle: 'Taxi',
      category: 'transit',
    });
    expect(next).toMatchObject({ category: 'transit', source: 'model', swaps: 0, tagged: false });
  });

  it('a keystroke or a tap takes the tag away; a chip you chose is never tagged', () => {
    const tagged = chipReducer(initialChipState('Grizzly House'), {
      type: 'reply',
      askedTitle: 'Grizzly House',
      currentTitle: 'Grizzly House',
      category: 'lodging',
    });
    expect(tagged.tagged).toBe(true);
    expect(chipReducer(tagged, { type: 'title', title: 'Grizzly House B' }).tagged).toBe(false);
    expect(chipReducer(tagged, { type: 'tap', category: 'lodging' })).toMatchObject({
      source: 'user',
      tagged: false,
    });
  });

  it('never re-infers once the user has tapped', () => {
    let s = chipReducer(initialChipState('Dinner'), { type: 'tap', category: 'drinks' });
    s = chipReducer(s, { type: 'title', title: 'Hotel' });
    expect(s).toMatchObject({ category: 'drinks', source: 'user' });
  });

  it('drops a reply for a title the field no longer shows', () => {
    const s = initialChipState('Grizzly');
    const next = chipReducer(s, {
      type: 'reply',
      askedTitle: 'Grizzly',
      currentTitle: 'Grizzly House',
      category: 'lodging',
    });
    expect(next).toBe(s);
  });

  it('drops a reply once the user has tapped, even for the same title', () => {
    const tapped = chipReducer(initialChipState('Grizzly House'), {
      type: 'tap',
      category: 'food',
    });
    const next = chipReducer(tapped, {
      type: 'reply',
      askedTitle: 'Grizzly House',
      currentTitle: 'Grizzly House',
      category: 'lodging',
    });
    expect(next).toBe(tapped);
  });

  it('lets a later model reply refine an earlier one', () => {
    let s = initialChipState('Fairmont');
    const reply = (category: Category) =>
      chipReducer(s, { type: 'reply', askedTitle: 'Fairmont', currentTitle: 'Fairmont', category });
    s = reply('food');
    s = reply('lodging');
    expect(s).toMatchObject({ category: 'lodging', source: 'model', swaps: 2 });
  });

  it('ignores a null reply', () => {
    const s = initialChipState('Nourish');
    expect(
      chipReducer(s, {
        type: 'reply',
        askedTitle: 'Nourish',
        currentTitle: 'Nourish',
        category: null,
      }),
    ).toBe(s);
  });

  it('freezes on Save', () => {
    let s = chipReducer(initialChipState('Dinner'), { type: 'freeze' });
    s = chipReducer(s, { type: 'title', title: 'Hotel' });
    s = chipReducer(s, { type: 'tap', category: 'gifts' });
    s = chipReducer(s, {
      type: 'reply',
      askedTitle: 'Dinner',
      currentTitle: 'Dinner',
      category: 'fees',
    });
    expect(s).toMatchObject({ category: 'food', frozen: true });
  });

  it('starts an edited expense from its saved category as the user choice', () => {
    expect(initialChipState('Hotel', 'gifts')).toMatchObject({ category: 'gifts', source: 'user' });
  });

  it('asks the model only for a non-empty title while the source is not user', () => {
    const s = initialChipState('');
    expect(shouldAskModel(s, '  ')).toBe(false);
    expect(shouldAskModel(s, 'Fairmont')).toBe(true);
    expect(shouldAskModel(chipReducer(s, { type: 'tap', category: 'food' }), 'Fairmont')).toBe(
      false,
    );
  });
});

describe('ChipController', () => {
  it('asks the model after a 500 ms pause, with the exact title, and applies the reply', async () => {
    const { chip, clock, model } = controller();
    chip.setTitle('G');
    clock.advance(200);
    chip.setTitle('Grizzly House');
    clock.advance(MODEL_PAUSE_MS - 1);
    expect(model.asked).toHaveLength(0);
    clock.advance(1);
    expect(model.asked.map((a) => a.title)).toEqual(['Grizzly House']);
    await model.reply(0, 'lodging');
    expect(chip.getState()).toMatchObject({ category: 'lodging', source: 'model', swaps: 1 });
  });

  it('shows the suggested tag for about 1.5 s after the model changes the chip', async () => {
    const { chip, clock, model } = controller();
    chip.setTitle('Grizzly House');
    clock.advance(MODEL_PAUSE_MS);
    await model.reply(0, 'lodging');
    expect(chip.getState()).toMatchObject({ category: 'lodging', tagged: true });
    clock.advance(SUGGESTED_TAG_MS - 1);
    expect(chip.getState().tagged).toBe(true);
    clock.advance(1);
    expect(chip.getState()).toMatchObject({ category: 'lodging', source: 'model', tagged: false });
  });

  it('a second model change restarts the tag time', async () => {
    const { chip, clock, model } = controller();
    chip.setTitle('Sunshine');
    clock.advance(MODEL_PAUSE_MS);
    await model.reply(0, 'groceries');
    clock.advance(1000);
    chip.setTitle('Sunshine Village lift');
    clock.advance(MODEL_PAUSE_MS);
    await model.reply(1, 'activities');
    clock.advance(SUGGESTED_TAG_MS - 1);
    expect(chip.getState()).toMatchObject({ category: 'activities', tagged: true });
    clock.advance(1);
    expect(chip.getState().tagged).toBe(false);
  });

  it('race: a model reply arriving after a user tap is dropped', async () => {
    const { chip, clock, model } = controller();
    chip.setTitle('Grizzly House');
    clock.advance(MODEL_PAUSE_MS);
    expect(model.asked).toHaveLength(1);
    chip.tap('food'); // the request is in flight
    await model.reply(0, 'lodging');
    expect(chip.getState()).toMatchObject({ category: 'food', source: 'user' });
    // And the tap is sticky: a later keystroke neither re-infers nor asks again.
    chip.setTitle('Grizzly House hotel');
    clock.advance(MODEL_PAUSE_MS);
    expect(model.asked).toHaveLength(1);
    expect(chip.getState()).toMatchObject({ category: 'food', source: 'user' });
  });

  it('race: a reply for a stale title is dropped, the reply for the current one applied', async () => {
    const { chip, clock, model } = controller();
    chip.setTitle('Sunshine');
    clock.advance(MODEL_PAUSE_MS);
    chip.setTitle('Sunshine Village lift');
    clock.advance(MODEL_PAUSE_MS);
    expect(model.asked.map((a) => a.title)).toEqual(['Sunshine', 'Sunshine Village lift']);
    // Replies arrive out of order: the current title's first, then the stale one.
    await model.reply(1, 'activities');
    await model.reply(0, 'groceries');
    expect(chip.getState()).toMatchObject({ category: 'activities', source: 'model' });
  });

  it('a pending pause is cancelled by the next keystroke, so only the last title is asked', () => {
    const { chip, clock, model } = controller();
    chip.setTitle('Fair');
    clock.advance(300);
    chip.setTitle('Fairmont');
    clock.advance(300);
    expect(model.asked).toHaveLength(0);
    clock.advance(200);
    expect(model.asked.map((a) => a.title)).toEqual(['Fairmont']);
  });

  it('a tap cancels the pending pause as well', () => {
    const { chip, clock, model } = controller();
    chip.setTitle('Fairmont');
    chip.tap('lodging');
    clock.advance(MODEL_PAUSE_MS);
    expect(model.asked).toHaveLength(0);
  });

  it('Save freezes the chip: a reply after Save is dropped', async () => {
    const { chip, clock, model } = controller();
    chip.setTitle('Nourish');
    clock.advance(MODEL_PAUSE_MS);
    expect(chip.freeze()).toBe('other');
    await model.reply(0, 'food');
    expect(chip.getState()).toMatchObject({ category: 'other', frozen: true });
  });

  it('a failing model leaves the keyword guess standing', async () => {
    const clock = manualClock();
    const chip = new ChipController('', initialChipState(''), {
      refine: () => Promise.reject(new Error('no model')),
      schedule: clock.schedule,
    });
    chip.setTitle('Taxi to Banff');
    clock.advance(MODEL_PAUSE_MS);
    await Promise.resolve();
    expect(chip.getState()).toMatchObject({ category: 'transit', source: 'keyword' });
  });

  it('notifies subscribers only when the chip changes', () => {
    const { chip } = controller();
    let calls = 0;
    chip.subscribe(() => {
      calls += 1;
    });
    chip.setTitle('Taxi');
    chip.setTitle('Taxi '); // same inference
    chip.tap('transit');
    expect(calls).toBe(2);
  });
});
