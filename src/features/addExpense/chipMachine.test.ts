import { CATEGORIES, type Category, type GroupState } from '@even/core';
import { afterEach, describe, expect, it } from 'vitest';

import {
  carriesSparkle,
  refineCategory,
  setCategoryHistory,
  setOnDeviceModel,
} from '@/state/categories';

import {
  ChipController,
  chipReducer,
  initialChipState,
  MODEL_PAUSE_MS,
  shouldAskModel,
  type ChipEvent,
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
      answeredTitle: null,
    });
    s = chipReducer(s, { type: 'title', title: 'Lake Louise shuttle' });
    expect(s.category).toBe('transit');
    s = chipReducer(s, {
      type: 'reply',
      askedTitle: 'Lake Louise shuttle',
      currentTitle: 'Lake Louise shuttle',
      category: 'activities',
    });
    expect(s).toMatchObject({
      category: 'activities',
      source: 'model',
      swaps: 1,
      answeredTitle: 'Lake Louise shuttle',
    });
    // A keystroke the table knows replaces a model suggestion at once (design.md: source ≠ user).
    s = chipReducer(s, { type: 'title', title: 'Lake Louise shuttle bus' });
    expect(s).toMatchObject({ category: 'transit', source: 'keyword' });
  });

  it("a keyword-inferred chip carries no sparkle; the model's pick carries it", () => {
    let s = chipReducer(initialChipState(''), { type: 'title', title: 'Lake Louise shuttle' });
    expect(s).toMatchObject({ category: 'transit', source: 'keyword', tagged: false });
    s = chipReducer(s, {
      type: 'reply',
      askedTitle: 'Lake Louise shuttle',
      currentTitle: 'Lake Louise shuttle',
      category: 'activities',
    });
    expect(s).toMatchObject({ category: 'activities', source: 'model', swaps: 1, tagged: true });
  });

  it("a model reply that agrees with the chip makes it the model's pick: the sparkle, no swap", () => {
    const s = chipReducer(initialChipState(''), { type: 'title', title: 'Taxi' });
    const next = chipReducer(s, {
      type: 'reply',
      askedTitle: 'Taxi',
      currentTitle: 'Taxi',
      category: 'transit',
    });
    expect(next).toMatchObject({ category: 'transit', source: 'model', swaps: 0, tagged: true });
  });

  it('a tap takes the sparkle away, even on the category the model picked; a chip you chose never has it', () => {
    const picked = chipReducer(initialChipState('Grizzly House'), {
      type: 'reply',
      askedTitle: 'Grizzly House',
      currentTitle: 'Grizzly House',
      category: 'lodging',
    });
    expect(picked.tagged).toBe(true);
    expect(chipReducer(picked, { type: 'tap', category: 'lodging' })).toMatchObject({
      category: 'lodging',
      source: 'user',
      tagged: false,
    });
    expect(chipReducer(picked, { type: 'tap', category: 'food' })).toMatchObject({
      category: 'food',
      source: 'user',
      tagged: false,
    });
    expect(initialChipState('Grizzly House', 'food').tagged).toBe(false);
  });

  it('a keystroke the local guess knows puts that guess back at once, with no sparkle', () => {
    const picked = chipReducer(initialChipState('Grizzly House'), {
      type: 'reply',
      askedTitle: 'Grizzly House',
      currentTitle: 'Grizzly House',
      category: 'lodging',
    });
    expect(chipReducer(picked, { type: 'title', title: 'Grizzly House taxi' })).toEqual({
      category: 'transit',
      source: 'keyword',
      frozen: false,
      swaps: 1,
      tagged: false,
      answeredTitle: null,
    });
  });

  it("a keystroke that continues the answered title, which the local guess does not know, keeps the model's pick", () => {
    const picked = chipReducer(initialChipState('Grizzly House'), {
      type: 'reply',
      askedTitle: 'Grizzly House',
      currentTitle: 'Grizzly House',
      category: 'lodging',
    });
    // Extending it, backspacing through it, and the same with other case and surrounding spaces: the pick stands.
    for (const title of ['Grizzly House B', 'Grizzly Hou', 'G', '  GRIZZLY HOUSE b ', 'grizzly']) {
      expect(chipReducer(picked, { type: 'title', title })).toBe(picked);
    }
    // A title that does not continue it (pasted over, edited in the middle) or an empty field: the local guess, Other.
    for (const title of ['Rimrock', 'Grizly House', 'House', '', '   ']) {
      expect(chipReducer(picked, { type: 'title', title })).toMatchObject({
        category: 'other',
        source: 'keyword',
        tagged: false,
        answeredTitle: null,
      });
    }
  });

  it('a reply for a continued title that agrees changes nothing shown; one that differs swaps the chip', () => {
    const answer = (s: ChipState, title: string, category: Category) =>
      chipReducer(s, { type: 'reply', askedTitle: title, currentTitle: title, category });
    const picked = answer(initialChipState('Surly'), 'Surly', 'drinks');
    const held = chipReducer(picked, { type: 'title', title: 'Surly’s brewing' });
    expect(held).toBe(picked);
    const agreed = answer(held, 'Surly’s brewing', 'drinks');
    expect(agreed).toEqual({ ...held, answeredTitle: 'Surly’s brewing' });
    const swapped = answer(agreed, 'Surly’s brewing', 'food');
    expect(swapped).toMatchObject({
      category: 'food',
      source: 'model',
      swaps: 2,
      tagged: true,
      answeredTitle: 'Surly’s brewing',
    });
  });

  it('Save keeps what shows: a frozen model pick keeps its sparkle', () => {
    const picked = chipReducer(initialChipState('Grizzly House'), {
      type: 'reply',
      askedTitle: 'Grizzly House',
      currentTitle: 'Grizzly House',
      category: 'lodging',
    });
    const saved = chipReducer(picked, { type: 'freeze' });
    expect(saved).toMatchObject({
      category: 'lodging',
      source: 'model',
      frozen: true,
      tagged: true,
    });
  });

  it('the sparkle and the answered title are derived from the source on every path, never set on their own', () => {
    // Every sequence of three events from a mixed set, from a fresh sheet and from an edited expense.
    const events: ChipEvent[] = [
      { type: 'title', title: 'Grizzly House' },
      { type: 'title', title: 'Grizzly House B' },
      { type: 'title', title: 'Taxi' },
      {
        type: 'reply',
        askedTitle: 'Grizzly House',
        currentTitle: 'Grizzly House',
        category: 'lodging',
      },
      { type: 'reply', askedTitle: 'Taxi', currentTitle: 'Taxi', category: 'transit' },
      { type: 'reply', askedTitle: 'Taxi', currentTitle: 'Taxi', category: null },
      { type: 'tap', category: CATEGORIES[0] },
      { type: 'tap', category: 'lodging' },
      { type: 'freeze' },
    ];
    const starts = [
      initialChipState(''),
      initialChipState('Taxi'),
      initialChipState('Hotel', 'gifts'),
    ];
    let checked = 0;
    for (const start of starts) {
      for (const a of events) {
        for (const b of events) {
          for (const c of events) {
            let s = start;
            for (const event of [a, b, c]) {
              s = chipReducer(s, event);
              expect(s.tagged).toBe(carriesSparkle(s));
              expect(s.answeredTitle !== null).toBe(s.source === 'model');
              checked += 1;
            }
          }
        }
      }
    }
    expect(checked).toBe(starts.length * events.length ** 3 * 3);
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

  it('asks the model only for a non-empty title the table does not know, while the source is not user', () => {
    const s = initialChipState('');
    expect(shouldAskModel(s, '  ')).toBe(false);
    expect(shouldAskModel(s, 'Rimrock')).toBe(true);
    expect(shouldAskModel(s, 'Fairmont')).toBe(false); // a keyword hit stands
    expect(shouldAskModel(s, 'Hotel bar')).toBe(true); // unless it names two categories (hotel, bar)
    expect(shouldAskModel(s, 'Train and Co Drama Theater')).toBe(false); // one category stands, however long
    expect(shouldAskModel(chipReducer(s, { type: 'tap', category: 'food' }), 'Rimrock')).toBe(
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

  it("the model's pick keeps its sparkle with no timer, until you pick a category", async () => {
    const { chip, clock, model } = controller();
    chip.setTitle('Grizzly House');
    clock.advance(MODEL_PAUSE_MS);
    await model.reply(0, 'lodging');
    expect(chip.getState()).toMatchObject({ category: 'lodging', source: 'model', tagged: true });
    clock.advance(60 * 60 * 1000); // an hour later: nothing takes it away on its own
    expect(chip.getState()).toMatchObject({ category: 'lodging', source: 'model', tagged: true });
    chip.tap('lodging');
    expect(chip.getState()).toMatchObject({ category: 'lodging', source: 'user', tagged: false });
  });

  it('a second model change counts a second swap and keeps the sparkle', async () => {
    const { chip, clock, model } = controller();
    chip.setTitle('Sunshine');
    clock.advance(MODEL_PAUSE_MS);
    await model.reply(0, 'groceries');
    expect(chip.getState()).toMatchObject({ category: 'groceries', swaps: 1, tagged: true });
    // The title goes on from the one the model answered and the table does not know it: the pick stands meanwhile.
    chip.setTitle('Sunshine Village lift');
    expect(chip.getState()).toMatchObject({ category: 'groceries', source: 'model', tagged: true });
    clock.advance(MODEL_PAUSE_MS);
    await model.reply(1, 'activities');
    expect(chip.getState()).toMatchObject({ category: 'activities', swaps: 2, tagged: true });
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
    chip.setTitle('Rim');
    clock.advance(300);
    chip.setTitle('Rimrock');
    clock.advance(300);
    expect(model.asked).toHaveLength(0);
    clock.advance(200);
    expect(model.asked.map((a) => a.title)).toEqual(['Rimrock']);
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
    expect(chip.getState()).toMatchObject({ category: 'other', frozen: true, tagged: false });
  });

  it("Save after the model's pick keeps the sparkle it shows", async () => {
    const { chip, clock, model } = controller();
    chip.setTitle('Grizzly House');
    clock.advance(MODEL_PAUSE_MS);
    await model.reply(0, 'lodging');
    expect(chip.freeze()).toBe('lodging');
    expect(chip.getState()).toMatchObject({ source: 'model', frozen: true, tagged: true });
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

describe('history first on the chip', () => {
  afterEach(() => setCategoryHistory(null));
  const saved = (...expenses: [string, Category][]) =>
    ({
      expenses: new Map(
        expenses.map(([title, category], i) => [`e${i}`, { title, category, updatedAt: i }]),
      ),
    }) as unknown as GroupState;

  it('shows a recalled category at once, as a keyword chip, and never asks the model about it', async () => {
    setCategoryHistory(() => [saved(['Nourish Bistro', 'food'], ['Dry cleaning', 'other'])]);
    const { chip, clock, model } = controller();
    chip.setTitle('Nourish');
    expect(chip.getState()).toMatchObject({ category: 'food', source: 'keyword', tagged: false });
    expect(shouldAskModel(chip.getState(), 'Nourish')).toBe(false);
    clock.advance(MODEL_PAUSE_MS);
    chip.setTitle('Dry cleaning');
    clock.advance(MODEL_PAUSE_MS);
    expect(model.asked).toEqual([]);
    expect(chip.freeze()).toBe('other');
  });

  it('asks the model again once the title is one neither history nor the table knows', async () => {
    setCategoryHistory(() => [saved(['Nourish Bistro', 'food'])]);
    const { chip, clock, model } = controller();
    chip.setTitle('Nourish');
    clock.advance(MODEL_PAUSE_MS);
    chip.setTitle('Nourishing Bowls');
    expect(chip.getState()).toMatchObject({ category: 'other', source: 'keyword' });
    clock.advance(MODEL_PAUSE_MS);
    expect(model.asked.map((a) => a.title)).toEqual(['Nourishing Bowls']);
  });
});

describe('which titles reach the model', () => {
  it('only titles neither history nor the keyword table knows: a keyword hit of one category stands and is never swapped', async () => {
    const { chip, clock, model } = controller();
    chip.setTitle('Banff parkade');
    clock.advance(MODEL_PAUSE_MS);
    chip.setTitle('Resort fee');
    clock.advance(MODEL_PAUSE_MS);
    expect(model.asked).toEqual([]);
    expect(chip.getState()).toMatchObject({ category: 'fees', source: 'keyword', swaps: 0 });
    chip.setTitle('Surly’s brewing');
    expect(chip.getState()).toMatchObject({ category: 'other', source: 'keyword' });
    clock.advance(MODEL_PAUSE_MS);
    expect(model.asked.map((a) => a.title)).toEqual(['Surly’s brewing']);
    await model.reply(0, 'drinks');
    expect(chip.getState()).toMatchObject({ category: 'drinks', source: 'model', swaps: 1 });
  });
});

/**
 * Typing at the phone's pace (design.md "Chip state machine"): keystrokes `KEY_GAP_MS` apart, a longer gap where the
 * person pauses, a clock that runs timers in time order, and a model that answers `latency` ms after it is asked. Every
 * change of the chip is recorded as the subscribers see it, so a flip between keystrokes cannot hide.
 */
const KEY_GAP_MS = 150;
const PAUSE_MS = 700;

function typist(answer: (title: string) => Category | null, { latency = 150 } = {}) {
  let now = 0;
  const timers: { at: number; fn: () => void; cancelled: boolean }[] = [];
  const schedule = (fn: () => void, ms: number) => {
    const timer = { at: now + ms, fn, cancelled: false };
    timers.push(timer);
    return () => {
      timer.cancelled = true;
    };
  };
  const asked: string[] = [];
  const chip = new ChipController('', initialChipState(''), {
    refine: (title) => {
      asked.push(title);
      return new Promise((resolve) => schedule(() => resolve(answer(title)), latency));
    },
    schedule,
  });
  let title = '';
  let gap = KEY_GAP_MS;
  /** The chip after each keystroke, as the title field reads then. */
  const keys: { title: string; category: Category; source: ChipState['source'] }[] = [];
  /** Every state the chip's subscribers were shown. */
  const shown: ChipState[] = [];
  chip.subscribe(() => shown.push(chip.getState()));
  const advance = async (ms: number) => {
    const until = now + ms;
    for (;;) {
      const due = timers
        .filter((t) => !t.cancelled && t.at <= until)
        .sort((a, b) => a.at - b.at)[0];
      if (due === undefined) break;
      now = due.at;
      due.cancelled = true;
      due.fn();
      // A reply that resolved reaches the chip (a microtask) before the clock moves on, as on the phone.
      await new Promise((resolve) => setTimeout(resolve, 0));
    }
    now = until;
  };
  const key = async (next: string) => {
    await advance(gap);
    gap = KEY_GAP_MS;
    title = next;
    chip.setTitle(next);
    const { category, source } = chip.getState();
    keys.push({ title: next, category, source });
  };
  return {
    chip,
    asked,
    keys,
    shown,
    /** Types `text` one character at a time. */
    async type(text: string) {
      for (const ch of text) await key(title + ch);
    },
    async backspace(count: number) {
      for (let i = 0; i < count; i += 1) await key(title.slice(0, -1));
    },
    /** The field changes at once: a paste over a selection, or select-all and a new first letter. */
    replace: key,
    /** The person stops typing: the next keystroke comes `ms` later. */
    pause(ms = PAUSE_MS) {
      gap = ms;
    },
    /** Waits `ms` with no keystroke, letting the pause, the request and the reply run. */
    wait: advance,
  };
}

/** Where the model first said `category`, and every chip shown after it. */
function afterFirst(shown: ChipState[], category: Category): ChipState[] {
  const first = shown.findIndex((s) => s.category === category);
  expect(first).toBeGreaterThanOrEqual(0);
  return shown.slice(first);
}

describe("the model's pick holds while the title goes on (the bounce seen on the phone)", () => {
  afterEach(() => setCategoryHistory(null));
  const drinks = (title: string): Category | null =>
    title.toLowerCase().startsWith('surly') ? 'drinks' : null;

  it('typing "Surly’s brewing" at 150 ms a key with 700 ms pauses: once the model says Drinks the chip never leaves it', async () => {
    const t = typist(drinks);
    await t.type('Surly');
    t.pause();
    await t.type('’s'); // the apostrophe threw the chip back to Other on the phone
    t.pause();
    await t.type(' brew');
    t.pause();
    await t.type('ing');
    await t.wait(PAUSE_MS);

    // The model is asked at each pause, about the title as it read then.
    expect(t.asked).toEqual(['Surly', 'Surly’s', 'Surly’s brew', 'Surly’s brewing']);
    // Other while nothing has answered; Drinks, the model's, from the first keystroke after the first answer to the end.
    expect(t.keys.map((k) => `${k.title}: ${k.category}/${k.source}`)).toEqual([
      'S: other/keyword',
      'Su: other/keyword',
      'Sur: other/keyword',
      'Surl: other/keyword',
      'Surly: other/keyword',
      'Surly’: drinks/model',
      'Surly’s: drinks/model',
      'Surly’s : drinks/model',
      'Surly’s b: drinks/model',
      'Surly’s br: drinks/model',
      'Surly’s bre: drinks/model',
      'Surly’s brew: drinks/model',
      'Surly’s brewi: drinks/model',
      'Surly’s brewin: drinks/model',
      'Surly’s brewing: drinks/model',
    ]);
    // Nothing the subscribers were shown after the first Drinks is anything else, and the sparkle never left.
    for (const s of afterFirst(t.shown, 'drinks')) {
      expect(s).toMatchObject({ category: 'drinks', source: 'model', tagged: true });
    }
    // One swap (Other to Drinks); the answers that agreed changed nothing shown.
    expect(t.chip.getState()).toMatchObject({
      category: 'drinks',
      source: 'model',
      swaps: 1,
      tagged: true,
      answeredTitle: 'Surly’s brewing',
    });
    expect(t.chip.freeze()).toBe('drinks');
  });

  it('a reply that lands after the next keystroke is dropped, and the chip still holds Drinks', async () => {
    // The model takes 300 ms: asked 500 ms into a 700 ms pause, it answers after the typing has resumed.
    const t = typist(drinks, { latency: 300 });
    await t.type('Surly');
    t.pause(1000); // a longer first pause: this answer lands
    await t.type('’s');
    t.pause();
    await t.type(' brew');
    t.pause();
    await t.type('ing');
    await t.wait(1000);
    expect(t.asked).toEqual(['Surly', 'Surly’s', 'Surly’s brew', 'Surly’s brewing']);
    expect(t.keys.slice(5).every((k) => k.category === 'drinks' && k.source === 'model')).toBe(
      true,
    );
    for (const s of afterFirst(t.shown, 'drinks')) {
      expect(s).toMatchObject({ category: 'drinks', source: 'model', tagged: true });
    }
    // Only the first and the last answers applied: the two in between were for titles the field had left.
    expect(t.chip.getState()).toMatchObject({ swaps: 1, answeredTitle: 'Surly’s brewing' });
  });

  it('a later answer that differs swaps the chip, with the sparkle', async () => {
    const t = typist((title) => (title === 'Surly’s brewing' ? 'food' : drinks(title)));
    await t.type('Surly');
    t.pause();
    await t.type('’s brewing');
    expect(t.chip.getState()).toMatchObject({ category: 'drinks', source: 'model', swaps: 1 });
    await t.wait(PAUSE_MS);
    expect(t.chip.getState()).toMatchObject({
      category: 'food',
      source: 'model',
      swaps: 2,
      tagged: true,
    });
    expect(t.shown.map((s) => s.category)).toEqual(['drinks', 'food']);
  });

  it('backspacing through the title the model answered keeps its pick; the pause asks again and it agrees', async () => {
    const t = typist(drinks);
    await t.type('Surly’s brewing');
    await t.wait(PAUSE_MS);
    expect(t.chip.getState()).toMatchObject({ category: 'drinks', source: 'model' });
    await t.backspace(10); // back to "Surly"
    expect(t.keys.slice(-10).map((k) => `${k.title}: ${k.category}/${k.source}`)).toEqual([
      'Surly’s brewin: drinks/model',
      'Surly’s brewi: drinks/model',
      'Surly’s brew: drinks/model',
      'Surly’s bre: drinks/model',
      'Surly’s br: drinks/model',
      'Surly’s b: drinks/model',
      'Surly’s : drinks/model',
      'Surly’s: drinks/model',
      'Surly’: drinks/model',
      'Surly: drinks/model',
    ]);
    await t.wait(PAUSE_MS);
    expect(t.asked).toEqual(['Surly’s brewing', 'Surly']);
    expect(t.chip.getState()).toMatchObject({ swaps: 1, answeredTitle: 'Surly' });
    for (const s of afterFirst(t.shown, 'drinks')) expect(s.category).toBe('drinks');
  });

  it('retyped from scratch: an emptied field starts over, Other until the model answers the new title', async () => {
    const t = typist(drinks);
    await t.type('Surly’s brewing');
    await t.wait(PAUSE_MS);
    await t.backspace('Surly’s brewing'.length);
    // Backspacing keeps the pick down to the last letter; the empty field (the placeholder) forgets it.
    expect(t.keys.at(-2)).toEqual({ title: 'S', category: 'drinks', source: 'model' });
    expect(t.keys.at(-1)).toEqual({ title: '', category: 'other', source: 'keyword' });
    const from = t.keys.length;
    await t.type('Surly’s brewing');
    expect(t.keys.slice(from).every((k) => k.category === 'other' && k.source === 'keyword')).toBe(
      true,
    );
    await t.wait(PAUSE_MS);
    expect(t.chip.getState()).toMatchObject({ category: 'drinks', source: 'model', swaps: 2 });
  });

  it('pasted over, or edited so it no longer continues: Other at once, as a keyword chip', async () => {
    const t = typist((title) => (title === 'Rimrock' ? 'lodging' : drinks(title)));
    await t.type('Surly’s brewing');
    await t.wait(PAUSE_MS);
    await t.replace('Rimrock'); // select-all, paste
    expect(t.chip.getState()).toMatchObject({
      category: 'other',
      source: 'keyword',
      tagged: false,
    });
    await t.wait(PAUSE_MS);
    expect(t.chip.getState()).toMatchObject({ category: 'lodging', source: 'model' });
    await t.replace('Rimrck'); // a letter deleted in the middle
    expect(t.chip.getState()).toMatchObject({
      category: 'other',
      source: 'keyword',
      tagged: false,
    });
  });

  it('a keyword hit applies at once, as a keyword chip without the sparkle, and is never sent to the model', async () => {
    const t = typist(drinks);
    await t.type('Surly’s');
    await t.wait(PAUSE_MS);
    await t.type(' taxi');
    expect(t.keys.slice(-5).map((k) => `${k.title}: ${k.category}/${k.source}`)).toEqual([
      'Surly’s : drinks/model',
      'Surly’s t: drinks/model',
      'Surly’s ta: drinks/model',
      'Surly’s tax: fees/keyword', // the table reads "tax" as fees
      'Surly’s taxi: transit/keyword',
    ]);
    await t.wait(PAUSE_MS);
    expect(t.asked).toEqual(['Surly’s']);
    expect(t.chip.getState()).toMatchObject({
      category: 'transit',
      source: 'keyword',
      tagged: false,
    });
  });

  it('a history hit applies at once too', async () => {
    setCategoryHistory(() => [
      {
        expenses: new Map([['e0', { title: 'Nourish Bistro', category: 'food', updatedAt: 1 }]]),
      } as unknown as GroupState,
    ]);
    const t = typist((title) => (title === 'Nou' ? 'drinks' : null));
    await t.type('Nou');
    await t.wait(PAUSE_MS);
    await t.type('rish');
    expect(t.keys.slice(-4).map((k) => `${k.title}: ${k.category}/${k.source}`)).toEqual([
      'Nour: drinks/model',
      'Nouri: drinks/model',
      'Nouris: drinks/model',
      'Nourish: food/keyword',
    ]);
    await t.wait(PAUSE_MS);
    expect(t.asked).toEqual(['Nou']);
  });

  it('a tap still wins over a held pick, and drops the answer in flight', async () => {
    const t = typist((title) => (title === 'Surly’s brewing' ? 'food' : drinks(title)), {
      latency: 300,
    });
    await t.type('Surly');
    await t.wait(PAUSE_MS + 300);
    await t.type('’s brewing');
    await t.wait(MODEL_PAUSE_MS + 100); // the request for "Surly’s brewing" is in flight
    expect(t.asked.at(-1)).toBe('Surly’s brewing');
    t.chip.tap('coffee');
    await t.wait(PAUSE_MS);
    expect(t.chip.getState()).toMatchObject({ category: 'coffee', source: 'user', tagged: false });
    await t.type(' co');
    expect(t.chip.getState()).toMatchObject({ category: 'coffee', source: 'user' });
  });
});

describe('the gate on the chip: keywords of two categories go to the model', () => {
  afterEach(() => setCategoryHistory(null));
  const drinks = (title: string): Category | null =>
    title.toLowerCase().startsWith('hotel bar') ? 'drinks' : null;

  it('"Hotel bar" shows the table\'s Lodging as typed, then the model\'s Drinks with the sparkle', async () => {
    const t = typist(drinks);
    await t.type('Hotel bar');
    expect(t.keys.at(-1)).toMatchObject({ category: 'lodging', source: 'keyword' });
    await t.wait(PAUSE_MS);
    expect(t.asked).toEqual(['Hotel bar']);
    expect(t.chip.getState()).toMatchObject({
      category: 'drinks',
      source: 'model',
      tagged: true,
      swaps: 1,
    });
  });

  it("the model's pick holds while the two-category title goes on, and the table's guess returns once it stands", async () => {
    const t = typist(drinks);
    await t.type('Hotel bar');
    await t.wait(PAUSE_MS);
    const shownBefore = t.shown.length;
    await t.type(' tab');
    // "Hotel bar t" … "Hotel bar tab" still name lodging and drinks: no bounce back to Lodging between keystrokes.
    expect(t.shown.slice(shownBefore).every((s) => s.category === 'drinks')).toBe(true);
    expect(t.keys.slice(-4).every((k) => k.category === 'drinks' && k.source === 'model')).toBe(
      true,
    );
    await t.wait(PAUSE_MS);
    expect(t.asked).toEqual(['Hotel bar', 'Hotel bar tab']);
    expect(t.chip.getState()).toMatchObject({ category: 'drinks', source: 'model', swaps: 1 });
    // Backspaced to "Hotel": one category, the table's guess stands at once.
    await t.backspace(8);
    expect(t.chip.getState()).toMatchObject({
      category: 'lodging',
      source: 'keyword',
      tagged: false,
    });
  });

  it('a keyword of one category stands in a long title and is never sent: "Train and Co Drama Theater"', async () => {
    const t = typist(() => 'activities');
    await t.type('Train and Co Drama Theater');
    await t.wait(PAUSE_MS);
    expect(t.asked).toEqual([]);
    expect(t.chip.getState()).toMatchObject({ category: 'transit', source: 'keyword', swaps: 0 });
  });
});

describe("the model's other is no answer (through refineCategory)", () => {
  afterEach(() => setOnDeviceModel(null));
  const settle = async () => {
    for (let i = 0; i < 5; i += 1) await new Promise((resolve) => setTimeout(resolve, 0));
  };

  function withModel(category: string) {
    setOnDeviceModel(
      {
        availability: async () => ({ status: 'available' }),
        classifyExpense: async () => ({
          category,
          outcome: category === 'other' ? 'other' : 'answered',
          ms: 250,
          model: 'general',
        }),
      },
      () => undefined,
    );
    const clock = manualClock();
    const chip = new ChipController('', initialChipState(''), {
      refine: refineCategory,
      schedule: clock.schedule,
    });
    return { chip, clock };
  }

  it('"Sur": the chip stays Other as the local guess, with no sparkle and no swap', async () => {
    const { chip, clock } = withModel('other');
    chip.setTitle('Sur');
    clock.advance(MODEL_PAUSE_MS);
    await settle();
    expect(chip.getState()).toMatchObject({
      category: 'other',
      source: 'keyword',
      tagged: false,
      swaps: 0,
    });
  });

  it("a two-category title keeps the table's guess when the model says other", async () => {
    const { chip, clock } = withModel('other');
    chip.setTitle('Hotel bar');
    clock.advance(MODEL_PAUSE_MS);
    await settle();
    expect(chip.getState()).toMatchObject({
      category: 'lodging',
      source: 'keyword',
      tagged: false,
    });
  });

  it('any other answer still reaches the chip', async () => {
    const { chip, clock } = withModel('drinks');
    chip.setTitle('Sur');
    clock.advance(MODEL_PAUSE_MS);
    await settle();
    expect(chip.getState()).toMatchObject({ category: 'drinks', source: 'model', tagged: true });
  });
});
