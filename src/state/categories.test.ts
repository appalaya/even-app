import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { CATEGORIES, inferCategory as coreInfer, type Category, type GroupState } from '@even/core';
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  carriesSparkle,
  categoryModelAvailability,
  chipAfterReply,
  chipAfterTap,
  chipAfterTitle,
  clearModelOutcomes,
  continuesTitle,
  createCategoryRefiner,
  createModelOutcomeLog,
  guessCategory,
  inferCategory,
  initialChip,
  installedOnDeviceModel,
  MODEL_LOG_PREFIX,
  MODEL_OUTCOMES_KEPT,
  needsModel,
  peekModelOutcomes,
  prepareCategoryModel,
  readAvailability,
  refineCategory,
  setCategoryHistory,
  setOnDeviceModel,
  shouldRefine,
  subscribeModelOutcomes,
  type CategoryChip,
  type ModelOutcomeEntry,
  type OnDeviceModel,
} from './categories';

/** The native reply for an answer: `said('drinks')`, or another outcome with no category. */
function said(category: string | null, outcome = category === null ? 'error' : 'answered') {
  return { category, outcome, ms: 250, model: 'general', detail: null };
}

/** A stub on-device model that records what it was asked; `answer` gives the raw native reply. */
function stubModel(
  answer: (title: string) => Promise<unknown>,
  availability: OnDeviceModel['availability'] = async () => ({ status: 'available' }),
) {
  const asked: string[] = [];
  let availabilityCalls = 0;
  let prewarms = 0;
  const model: OnDeviceModel = {
    availability: () => {
      availabilityCalls += 1;
      return availability();
    },
    classifyExpense: (title) => {
      asked.push(title);
      return answer(title);
    },
    prewarm: async () => {
      prewarms += 1;
    },
  };
  return {
    model,
    asked,
    availabilityCalls: () => availabilityCalls,
    prewarms: () => prewarms,
  };
}

const nativeDir = fileURLToPath(new URL('../../modules/even-classifier/', import.meta.url));
const sources = (dir: string, extension: string): string[] =>
  readdirSync(join(nativeDir, dir), { recursive: true, encoding: 'utf8' })
    .filter((name) => name.endsWith(extension))
    .map((name) => readFileSync(join(nativeDir, dir, name), 'utf8'));

describe('categories', () => {
  it('inferCategory is core keyword inference, unchanged', () => {
    for (const title of ['Dinner at Nourish', 'Uber to hotel', 'Parkade', 'Sunshine lift', '']) {
      expect(inferCategory(title)).toBe(coreInfer(title));
    }
    expect(CATEGORIES).toContain(inferCategory('Gas'));
  });

  it('keystrokes re-infer until the user taps', () => {
    let chip = initialChip('');
    expect(chip).toEqual({ category: 'other', source: 'keyword' });
    chip = chipAfterTitle(chip, 'Dinner');
    expect(chip).toEqual({ category: 'food', source: 'keyword' });
    chip = chipAfterTap(chip, 'drinks');
    expect(chip).toEqual({ category: 'drinks', source: 'user' });
    expect(chipAfterTitle(chip, 'Uber')).toBe(chip);
  });

  it('a model reply applies only for the exact title asked about, and never over a tap', () => {
    const chip = chipAfterTitle(initialChip(''), 'Fairmont Banff');
    expect(shouldRefine(chip, 'Fairmont Banff')).toBe(false); // the table knows it: the keyword hit stands
    expect(shouldRefine(chip, 'Rimrock Banff')).toBe(true); // neither history nor the table does
    expect(shouldRefine(chip, '   ')).toBe(false);
    const applied = chipAfterReply(chip, 'Fairmont Banff', {
      askedTitle: 'Fairmont Banff',
      category: 'lodging',
    });
    expect(applied).toEqual({
      category: 'lodging',
      source: 'model',
      answeredTitle: 'Fairmont Banff',
    });
    // The field moved on: the stale reply is dropped.
    expect(
      chipAfterReply(chip, 'Fairmont Banff spa', {
        askedTitle: 'Fairmont Banff',
        category: 'lodging',
      }),
    ).toBe(chip);
    // The user tapped meanwhile: the reply is dropped.
    const tapped = chipAfterTap(chip, 'activities');
    expect(
      chipAfterReply(tapped, 'Fairmont Banff', {
        askedTitle: 'Fairmont Banff',
        category: 'lodging',
      }),
    ).toBe(tapped);
    expect(shouldRefine(tapped, 'Fairmont Banff')).toBe(false);
    // No answer: nothing changes.
    expect(
      chipAfterReply(chip, 'Fairmont Banff', { askedTitle: 'Fairmont Banff', category: null }),
    ).toBe(chip);
  });

  it('a later model reply refines an earlier one', () => {
    const first = chipAfterReply(chipAfterTitle(initialChip(''), 'Sunshine'), 'Sunshine', {
      askedTitle: 'Sunshine',
      category: 'lodging',
    });
    expect(first).toEqual({ category: 'lodging', source: 'model', answeredTitle: 'Sunshine' });
    expect(shouldRefine(first, 'Sunshine')).toBe(true);
    const refined = chipAfterReply(first, 'Sunshine', {
      askedTitle: 'Sunshine',
      category: 'activities',
    });
    expect(refined).toEqual({ category: 'activities', source: 'model', answeredTitle: 'Sunshine' });
    // The same answer again changes nothing.
    expect(
      chipAfterReply(refined, 'Sunshine', { askedTitle: 'Sunshine', category: 'activities' }),
    ).toBe(refined);
    // The same answer for a longer title changes only the title it answered.
    expect(
      chipAfterReply(refined, 'Sunshine Village', {
        askedTitle: 'Sunshine Village',
        category: 'activities',
      }),
    ).toEqual({ category: 'activities', source: 'model', answeredTitle: 'Sunshine Village' });
    // A stale model reply is still dropped.
    expect(
      chipAfterReply(refined, 'Sunshine lift', { askedTitle: 'Sunshine', category: 'lodging' }),
    ).toBe(refined);
  });

  it('a keystroke the table knows replaces a model answer at once, as a keyword chip', () => {
    const model = chipAfterReply(initialChip('Nourish'), 'Nourish', {
      askedTitle: 'Nourish',
      category: 'food',
    });
    expect(model).toEqual({ category: 'food', source: 'model', answeredTitle: 'Nourish' });
    expect(chipAfterTitle(model, 'Nourish parking')).toEqual({
      category: 'parking',
      source: 'keyword',
    });
    // Even when the table agrees with the model, the chip is a keyword guess again.
    expect(chipAfterTitle(model, 'Nourish dinner')).toEqual({
      category: 'food',
      source: 'keyword',
    });
    expect(shouldRefine(model, 'Nourish')).toBe(true);
  });

  it('an edited expense starts from its saved category as a user choice', () => {
    expect(initialChip('Uber', 'food')).toEqual({ category: 'food', source: 'user' });
  });

  it("the sparkle marks the model's pick until a tap or a keystroke that replaces it, and nothing else", () => {
    const keyword = chipAfterTitle(initialChip(''), 'Taxi');
    expect(carriesSparkle(keyword)).toBe(false);
    const model = chipAfterReply(
      chipAfterTitle(initialChip(''), "Surly's brewing"),
      "Surly's brewing",
      {
        askedTitle: "Surly's brewing",
        category: 'drinks',
      },
    );
    expect(carriesSparkle(model)).toBe(true);
    // The model agreeing with the table makes it the model's pick too.
    expect(
      carriesSparkle(chipAfterReply(keyword, 'Taxi', { askedTitle: 'Taxi', category: 'transit' })),
    ).toBe(true);
    // A tap, even on the model's own pick, takes it away; so does a keystroke whose local guess replaces the pick
    // (a keyword hit, or a title that does not continue the one answered).
    expect(carriesSparkle(chipAfterTap(model, 'drinks'))).toBe(false);
    expect(carriesSparkle(chipAfterTitle(model, "Surly's brewing bar"))).toBe(false);
    expect(carriesSparkle(chipAfterTitle(model, 'Rimrock'))).toBe(false);
    // A keystroke that goes on with the title answered, which the table does not know, keeps it.
    expect(carriesSparkle(chipAfterTitle(model, "Surly's brewing co"))).toBe(true);
    expect(carriesSparkle(initialChip('Uber', 'food'))).toBe(false);
  });

  it('continuesTitle: one title starts with the other, after trimming and case folding; empty continues nothing', () => {
    expect(continuesTitle('Surly', "Surly's brewing")).toBe(true); // extending
    expect(continuesTitle("Surly's brewing", 'Surly')).toBe(true); // backspacing
    expect(continuesTitle('Surly', 'Surly')).toBe(true);
    expect(continuesTitle("  SURLY'S ", "surly's brewing")).toBe(true);
    expect(continuesTitle('Surly', 'surl')).toBe(true);
    expect(continuesTitle("Surly's brewing", 'Surly brewing')).toBe(false); // edited in the middle
    expect(continuesTitle('Surly', 'Rimrock')).toBe(false); // pasted over
    expect(continuesTitle('Surly', '')).toBe(false); // emptied: starting over
    expect(continuesTitle('Surly', '   ')).toBe(false);
  });

  it("a keystroke that continues the answered title keeps the model's pick while the local guess knows nothing", () => {
    const model = chipAfterReply(initialChip('Surly'), 'Surly', {
      askedTitle: 'Surly',
      category: 'drinks',
    });
    for (const title of ["Surly'", "Surly's brewing", 'Sur', 'SURLY ', "surly's brewing co"]) {
      expect(chipAfterTitle(model, title)).toBe(model);
    }
    // History or the table knowing the new title wins at once, even when it agrees with the model.
    expect(chipAfterTitle(model, "Surly's bar")).toEqual({ category: 'drinks', source: 'keyword' });
    expect(chipAfterTitle(model, "Surly's taxi")).toEqual({
      category: 'transit',
      source: 'keyword',
    });
    // Not a continuation: the local guess, Other.
    for (const title of ['Rimrock', 'Sunshine', '']) {
      expect(chipAfterTitle(model, title)).toEqual({ category: 'other', source: 'keyword' });
    }
    // A keyword chip showing Other is not the model's pick: nothing to keep.
    const keyword = chipAfterTitle(initialChip(''), 'Surly');
    expect(chipAfterTitle(keyword, "Surly's")).toBe(keyword);
    expect(keyword).toEqual({ category: 'other', source: 'keyword' });
  });

  it('replays "Surly\'s brewing" typed with pauses: once the model says Drinks the chip never leaves it', () => {
    // Keystrokes with a pause after "Surly", "Surly's" and "Surly's brew", where the model answers the title as it
    // reads; the phone showed Other again on each keystroke after an answer.
    const pausesAfter = new Set(['Surly', "Surly's", "Surly's brew", "Surly's brewing"]);
    let chip: CategoryChip = initialChip('');
    const seen: string[] = [];
    let title = '';
    for (const ch of "Surly's brewing") {
      title += ch;
      chip = chipAfterTitle(chip, title);
      seen.push(`${title}: ${chip.category}/${chip.source}`);
      if (pausesAfter.has(title) && shouldRefine(chip, title)) {
        chip = chipAfterReply(chip, title, { askedTitle: title, category: 'drinks' });
      }
    }
    expect(seen).toEqual([
      'S: other/keyword',
      'Su: other/keyword',
      'Sur: other/keyword',
      'Surl: other/keyword',
      'Surly: other/keyword',
      "Surly': drinks/model",
      "Surly's: drinks/model",
      "Surly's : drinks/model",
      "Surly's b: drinks/model",
      "Surly's br: drinks/model",
      "Surly's bre: drinks/model",
      "Surly's brew: drinks/model",
      "Surly's brewi: drinks/model",
      "Surly's brewin: drinks/model",
      "Surly's brewing: drinks/model",
    ]);
    expect(chip).toEqual({ category: 'drinks', source: 'model', answeredTitle: "Surly's brewing" });
  });
});

/** A group's reduced state with just the expenses history reads (title, category, when last changed). */
function groupWith(...expenses: [title: string, category: Category, at?: number][]): GroupState {
  const map = new Map(
    expenses.map(([title, category, at = 1], i) => [
      `e${i}`,
      { id: `e${i}`, title, category, addedAt: at, updatedAt: at },
    ]),
  );
  return { expenses: map } as unknown as GroupState;
}

describe('history first (the category saved with the same or a similar title earlier)', () => {
  afterEach(() => {
    setCategoryHistory(null);
    prepareCategoryModel(null);
  });

  it('recalls a saved title before the keyword table, and says where each guess came from', () => {
    setCategoryHistory(() => [groupWith(['Nourish Bistro', 'food'], ['Uber', 'food'])]);
    expect(guessCategory('Nourish')).toEqual({ category: 'food', from: 'history', mixed: false });
    // A saved choice beats the table.
    expect(guessCategory('uber')).toEqual({ category: 'food', from: 'history', mixed: false });
    expect(guessCategory('Uber Eats')).toEqual({ category: 'food', from: 'table', mixed: false });
    expect(guessCategory('Gas')).toEqual({ category: 'fuel', from: 'table', mixed: false });
    expect(guessCategory('Rundle')).toEqual({ category: 'other', from: 'none', mixed: false });
    expect(inferCategory('Nourish Bistro')).toBe('food');
    expect(chipAfterTitle(initialChip(''), 'Nourish')).toEqual({
      category: 'food',
      source: 'keyword',
    });
  });

  it('looks in the open group first (set when Add expense opens), then every other group', () => {
    const banff = groupWith(['Rundle', 'drinks']);
    const home = groupWith(['Rundle', 'activities'], ['Nesters', 'groceries']);
    const asked: (string | null)[] = [];
    setCategoryHistory((open) => {
      asked.push(open);
      return open === 'banff' ? [banff, home] : [home, banff];
    });
    prepareCategoryModel('banff');
    expect(inferCategory('Rundle')).toBe('drinks');
    expect(inferCategory('Nesters')).toBe('groceries'); // not in the open group: any group on this phone
    prepareCategoryModel('home');
    expect(inferCategory('Rundle')).toBe('activities');
    expect(asked).toEqual(['banff', 'banff', 'home']);
  });

  it('learns from a tap once it is saved: the replaced state is indexed afresh', () => {
    let state = groupWith(['Dry cleaning', 'rental', 1]);
    setCategoryHistory(() => [state]);
    expect(inferCategory('Dry cleaning')).toBe('rental');
    // The person tapped Other and saved an expense titled the same: the group state is replaced.
    state = groupWith(['Dry cleaning', 'rental', 1], ['dry cleaning', 'other', 2]);
    expect(inferCategory('Dry cleaning')).toBe('other');
  });

  it('indexes each state once, however many keystrokes ask', () => {
    let reads = 0;
    const state = groupWith(['Nourish Bistro', 'food']);
    const expenses = state.expenses;
    Object.defineProperty(state, 'expenses', {
      get: () => {
        reads += 1;
        return expenses;
      },
    });
    setCategoryHistory(() => [state]);
    for (const title of ['N', 'No', 'Nou', 'Nourish', 'Nourish B']) inferCategory(title);
    expect(reads).toBe(1);
  });

  it('falls back to the keyword table when there is no history or the source fails', () => {
    expect(guessCategory('Nourish')).toEqual({ category: 'other', from: 'none', mixed: false });
    setCategoryHistory(() => {
      throw new Error('not open yet');
    });
    expect(guessCategory('Gas')).toEqual({ category: 'fuel', from: 'table', mixed: false });
    setCategoryHistory(() => []);
    expect(inferCategory('Parkade')).toBe(coreInfer('Parkade'));
  });
});

describe('refineCategory (the on-device model)', () => {
  const quiet = () => undefined;
  afterEach(() => setOnDeviceModel(null));

  it('has no answer while no model is installed', async () => {
    await expect(refineCategory("Surly's brewing")).resolves.toBeNull();
  });

  it("returns the installed model's answer when it is one of the sixteen categories", async () => {
    const stub = stubModel(async (title) =>
      said(title === "Surly's brewing" ? 'drinks' : 'lodging'),
    );
    setOnDeviceModel(stub.model, quiet);
    await expect(refineCategory("Surly's brewing")).resolves.toBe('drinks');
    await expect(refineCategory('Fairmont Banff Springs')).resolves.toBe('lodging');
    expect(stub.asked).toEqual(["Surly's brewing", 'Fairmont Banff Springs']);
  });

  it("maps the model's other to null, so the chip keeps its local guess with no sparkle", async () => {
    for (const reply of [said('other', 'other'), said('other'), said('other', 'answered')]) {
      const { refine } = createCategoryRefiner(stubModel(async () => reply).model, quiet);
      await expect(refine('Sur')).resolves.toBeNull();
    }
  });

  it('maps a refusal, a timeout, an error or no model to null', async () => {
    for (const outcome of ['refused', 'timeout', 'error', 'unavailable', 'blank']) {
      const { refine } = createCategoryRefiner(
        stubModel(async () => said(null, outcome)).model,
        quiet,
      );
      await expect(refine('Hazy IPA')).resolves.toBeNull();
    }
    // A category next to an outcome that is not `answered` is not an answer either.
    const { refine } = createCategoryRefiner(
      stubModel(async () => ({ ...said('drinks'), outcome: 'refused' })).model,
      quiet,
    );
    await expect(refine('Hazy IPA')).resolves.toBeNull();
  });

  it('maps anything that is not a category id to null', async () => {
    for (const category of [
      'Drinks',
      ' drinks',
      'brewing',
      '',
      'toString',
      '__proto__',
      null,
      42,
      { id: 'food' },
    ]) {
      const { refine } = createCategoryRefiner(
        stubModel(async () => ({ ...said('drinks'), category })).model,
        quiet,
      );
      await expect(refine("Surly's brewing")).resolves.toBeNull();
    }
    // Malformed replies: a bare string (the old contract), nothing, a list, an unknown outcome.
    for (const reply of [
      'drinks',
      null,
      undefined,
      ['drinks'],
      { category: 'drinks', outcome: 'yes' },
    ]) {
      const { refine } = createCategoryRefiner(stubModel(async () => reply).model, quiet);
      await expect(refine("Surly's brewing")).resolves.toBeNull();
    }
  });

  it('treats a rejection or a throw as no answer', async () => {
    const { refine: rejects } = createCategoryRefiner(
      stubModel(() => Promise.reject(new Error('guardrail'))).model,
      quiet,
    );
    await expect(rejects("Surly's brewing")).resolves.toBeNull();
    const { refine: throws } = createCategoryRefiner(
      stubModel(() => {
        throw new Error('native module gone');
      }).model,
      quiet,
    );
    await expect(throws("Surly's brewing")).resolves.toBeNull();
  });

  it('does not ask about a blank title', async () => {
    const stub = stubModel(async () => said('food'));
    const { refine } = createCategoryRefiner(stub.model, quiet);
    await expect(refine('   ')).resolves.toBeNull();
    expect(stub.asked).toEqual([]);
    expect(stub.availabilityCalls()).toBe(0);
  });

  it('asks for availability once per session and keeps the answer', async () => {
    const stub = stubModel(async () => said('activities'));
    const { refine } = createCategoryRefiner(stub.model, quiet);
    await Promise.all([
      refine('Sunshine'),
      refine('Sunshine Village'),
      refine('Sunshine Village lift'),
    ]);
    await refine('Norquay');
    expect(stub.availabilityCalls()).toBe(1);
    expect(stub.asked).toHaveLength(4);
  });

  it('never asks an unavailable model, for the rest of the session', async () => {
    const stub = stubModel(
      async () => said('food'),
      async () => ({ status: 'unavailable', reason: 'appleIntelligenceNotEnabled' }),
    );
    const { refine } = createCategoryRefiner(stub.model, quiet);
    await expect(refine('Nourish Bistro')).resolves.toBeNull();
    await expect(refine('Nourish Bistro dinner')).resolves.toBeNull();
    expect(stub.availabilityCalls()).toBe(1);
    expect(stub.asked).toEqual([]);
  });

  it('treats a failed availability check as unavailable, without retrying', async () => {
    const stub = stubModel(
      async () => said('food'),
      () => Promise.reject(new Error('no native module')),
    );
    const { refine } = createCategoryRefiner(stub.model, quiet);
    await expect(refine('Nourish')).resolves.toBeNull();
    await expect(refine('Nourish Bistro')).resolves.toBeNull();
    expect(stub.availabilityCalls()).toBe(1);
    expect(stub.asked).toEqual([]);
  });

  it('starts a fresh session when a model is installed again', async () => {
    const unavailable = stubModel(
      async () => said('food'),
      async () => ({ status: 'unavailable', reason: 'modelNotReady' }),
    );
    setOnDeviceModel(unavailable.model, quiet);
    await expect(refineCategory('Nourish')).resolves.toBeNull();
    const ready = stubModel(async () => said('food'));
    setOnDeviceModel(ready.model, quiet);
    await expect(refineCategory('Nourish')).resolves.toBe('food');
  });
});

describe('the model diagnostics (design.md "Reading the logs")', () => {
  /** A distinctive title, so a leak into any log line is unmistakable. */
  const TITLE = 'Hazy IPA at Zorblax Taphouse';

  function recorder() {
    const lines: string[] = [];
    return { lines, log: (line: string) => lines.push(line) };
  }

  it('logs availability once per session, with the reason when unavailable', async () => {
    const available = recorder();
    const { refine } = createCategoryRefiner(
      stubModel(async () => said('drinks')).model,
      available.log,
    );
    await refine(TITLE);
    await refine(TITLE);
    expect(available.lines.filter((l) => l.includes('availability'))).toEqual([
      `${MODEL_LOG_PREFIX} availability available`,
    ]);

    const off = recorder();
    const unavailable = createCategoryRefiner(
      stubModel(
        async () => said('drinks'),
        async () => ({ status: 'unavailable', reason: 'appleIntelligenceNotEnabled' }),
      ).model,
      off.log,
    );
    await unavailable.refine(TITLE);
    await unavailable.refine(TITLE);
    expect(off.lines).toEqual([
      `${MODEL_LOG_PREFIX} availability unavailable reason=appleIntelligenceNotEnabled`,
    ]);

    const failed = recorder();
    await createCategoryRefiner(
      stubModel(
        async () => said('drinks'),
        () => Promise.reject(new Error('gone')),
      ).model,
      failed.log,
    ).refine(TITLE);
    expect(failed.lines).toEqual([
      `${MODEL_LOG_PREFIX} availability unavailable reason=checkFailed`,
    ]);
  });

  it('logs each reply: outcome, category, milliseconds, model and the error kind', async () => {
    const replies: unknown[] = [
      said('drinks'),
      said('other', 'other'),
      {
        category: null,
        outcome: 'refused',
        ms: 180,
        model: 'contentTagging',
        detail: 'guardrailViolation',
      },
      said(null, 'timeout'),
      said('Drinks'),
    ];
    const { lines, log } = recorder();
    const { refine } = createCategoryRefiner(stubModel(async () => replies.shift()).model, log);
    for (let i = 0; i < 5; i += 1) await refine(TITLE);
    const replyLines = lines.slice(1).map((l) => l.replace(/ms=\d+/, 'ms=N'));
    expect(replyLines).toEqual([
      `${MODEL_LOG_PREFIX} outcome=answered category=drinks ms=N model=general`,
      `${MODEL_LOG_PREFIX} outcome=other category=- ms=N model=general`,
      `${MODEL_LOG_PREFIX} outcome=refused category=- ms=N model=contentTagging detail=guardrailViolation`,
      `${MODEL_LOG_PREFIX} outcome=timeout category=- ms=N model=general`,
      `${MODEL_LOG_PREFIX} outcome=error category=- ms=N model=general detail=notACategory`,
    ]);
  });

  it('never logs the title, even when the native side echoes it back', async () => {
    const echoes: unknown[] = [
      { category: TITLE, outcome: 'answered', ms: 1, model: TITLE, detail: TITLE },
      {
        category: null,
        outcome: TITLE,
        ms: TITLE,
        model: 'general',
        detail: `guardrail: ${TITLE}`,
      },
      TITLE,
    ];
    const { lines, log } = recorder();
    const model = stubModel(async () => echoes.shift());
    const { refine } = createCategoryRefiner(model.model, log);
    for (let i = 0; i < 3; i += 1) await refine(TITLE);
    await createCategoryRefiner(
      stubModel(() => Promise.reject(new Error(TITLE))).model,
      log,
    ).refine(TITLE);
    expect(lines.length).toBeGreaterThanOrEqual(5);
    for (const line of lines) {
      expect(line).not.toMatch(/Hazy|Zorblax|IPA|Taphouse/);
      expect(line.startsWith(MODEL_LOG_PREFIX)).toBe(true);
    }
  });

  it('never logs a one-word title echoed back as the model or the detail', async () => {
    // One word passes the word filter the reason and the error kind go through, so the checks cannot rest on the
    // title having a space in it.
    const WORD = 'Zorblax';
    const echoes: unknown[] = [
      { category: null, outcome: 'refused', ms: 1, model: WORD, detail: WORD },
      { category: null, outcome: 'error', ms: 1, model: 'general', detail: WORD.toLowerCase() },
      { category: null, outcome: 'timeout', ms: 1, model: WORD.toUpperCase(), detail: null },
    ];
    const { lines, log } = recorder();
    const { refine } = createCategoryRefiner(stubModel(async () => echoes.shift()).model, log);
    for (let i = 0; i < 3; i += 1) await refine(WORD);
    expect(lines.slice(1).map((l) => l.replace(/ms=\d+/, 'ms=N'))).toEqual([
      `${MODEL_LOG_PREFIX} outcome=refused category=- ms=N model=-`,
      `${MODEL_LOG_PREFIX} outcome=error category=- ms=N model=general`,
      `${MODEL_LOG_PREFIX} outcome=timeout category=- ms=N model=-`,
    ]);
    for (const line of lines) expect(line.toLowerCase()).not.toContain('zorblax');
  });

  it('a log that throws costs nothing: the answer still arrives', async () => {
    const { refine } = createCategoryRefiner(stubModel(async () => said('drinks')).model, () => {
      throw new Error('console gone');
    });
    await expect(refine(TITLE)).resolves.toBe('drinks');
  });

  it('logs to console.log by default', async () => {
    const spy = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    try {
      await createCategoryRefiner(stubModel(async () => said('drinks')).model).refine(TITLE);
      expect(spy.mock.calls.map((call) => String(call[0]))).toEqual([
        `${MODEL_LOG_PREFIX} availability available`,
        expect.stringMatching(
          /^\[even\] category model outcome=answered category=drinks ms=\d+ model=general$/,
        ),
      ]);
    } finally {
      spy.mockRestore();
    }
  });
});

describe('the outcomes since launch (Diagnostics, useCategoryModelLog)', () => {
  const quiet = () => undefined;
  const TITLE = 'Hazy IPA at Zorblax Taphouse';
  afterEach(() => {
    setOnDeviceModel(null);
    clearModelOutcomes();
  });

  function entry(n: number): ModelOutcomeEntry {
    return { outcome: 'answered', category: 'food', ms: n, model: 'general', at: 1_000 + n };
  }

  it('keeps the last 20, newest first, and drops the oldest', () => {
    const ring = createModelOutcomeLog();
    expect(ring.peek()).toEqual([]);
    for (let n = 1; n <= 25; n += 1) ring.record(entry(n));
    const kept = ring.peek();
    expect(MODEL_OUTCOMES_KEPT).toBe(20);
    expect(kept).toHaveLength(20);
    expect(kept.map((e) => e.ms)).toEqual(Array.from({ length: 20 }, (_, i) => 25 - i));
  });

  it('keeps the snapshot until the next outcome, and tells subscribers once per outcome', () => {
    const ring = createModelOutcomeLog(3);
    let calls = 0;
    const off = ring.subscribe(() => {
      calls += 1;
    });
    const empty = ring.peek();
    expect(ring.peek()).toBe(empty);
    ring.record(entry(1));
    const one = ring.peek();
    expect(one).not.toBe(empty);
    expect(ring.peek()).toBe(one);
    expect(calls).toBe(1);
    off();
    ring.record(entry(2));
    expect(calls).toBe(1);
    expect(ring.peek().map((e) => e.ms)).toEqual([2, 1]);
    ring.clear();
    expect(ring.peek()).toEqual([]);
  });

  it('keeps copies: changing a recorded entry or the snapshot changes nothing kept', () => {
    const ring = createModelOutcomeLog();
    const e = entry(1);
    ring.record(e);
    e.ms = 999;
    expect(ring.peek()[0]?.ms).toBe(1);
    expect(Object.isFrozen(ring.peek())).toBe(true);
    expect(Object.isFrozen(ring.peek()[0])).toBe(true);
  });

  it('a subscriber that throws costs nothing: the others still hear, the outcome is kept', () => {
    const ring = createModelOutcomeLog();
    let heard = 0;
    ring.subscribe(() => {
      throw new Error('broken screen');
    });
    ring.subscribe(() => {
      heard += 1;
    });
    ring.record(entry(1));
    expect(heard).toBe(1);
    expect(ring.peek()).toHaveLength(1);
  });

  it('refineCategory keeps every model reply: outcome, category, milliseconds, model and time', async () => {
    const replies: unknown[] = [
      said('drinks'),
      said('other', 'other'),
      {
        category: null,
        outcome: 'refused',
        ms: 180,
        model: 'contentTagging',
        detail: 'guardrailViolation',
      },
      said(null, 'timeout'),
      said(null, 'error'),
      said(null, 'unavailable'),
      said('Drinks'),
      'drinks',
    ];
    setOnDeviceModel(stubModel(async () => replies.shift()).model, quiet);
    const before = Date.now();
    for (let i = 0; i < 8; i += 1) await refineCategory(TITLE);
    const kept = peekModelOutcomes();
    expect(kept.map((e) => [e.outcome, e.category, e.model])).toEqual(
      [
        ['answered', 'drinks', 'general'],
        ['none', null, 'general'],
        ['refused', null, 'contentTagging'],
        ['timeout', null, 'general'],
        ['error', null, 'general'],
        ['none', null, 'general'],
        ['error', null, 'general'],
        ['error', null, null],
      ].reverse(),
    );
    for (const e of kept) {
      expect(e.ms).toBeGreaterThanOrEqual(0);
      expect(e.at).toBeGreaterThanOrEqual(before);
      expect(e.at).toBeLessThanOrEqual(Date.now());
    }
  });

  it('keeps a rejection or a throw as an error', async () => {
    setOnDeviceModel(stubModel(() => Promise.reject(new Error(TITLE))).model, quiet);
    await refineCategory(TITLE);
    expect(peekModelOutcomes().map((e) => e.outcome)).toEqual(['error']);
  });

  it('never keeps the title, even when the native side echoes it back', async () => {
    const echoes: unknown[] = [
      { category: TITLE, outcome: 'answered', ms: 1, model: TITLE, detail: TITLE },
      {
        category: null,
        outcome: TITLE,
        ms: TITLE,
        model: 'general',
        detail: `guardrail: ${TITLE}`,
      },
      TITLE,
    ];
    setOnDeviceModel(stubModel(async () => echoes.shift()).model, quiet);
    for (let i = 0; i < 3; i += 1) await refineCategory(TITLE);
    const kept = peekModelOutcomes();
    expect(kept).toHaveLength(3);
    for (const e of kept) {
      expect(Object.keys(e).sort()).toEqual(['at', 'category', 'model', 'ms', 'outcome']);
      expect(JSON.stringify(e)).not.toMatch(/Hazy|Zorblax|IPA|Taphouse/);
    }
  });

  it('never keeps a one-word title echoed back as the model', async () => {
    setOnDeviceModel(
      stubModel(async () => ({ category: 'drinks', outcome: 'answered', ms: 1, model: 'Zorblax' }))
        .model,
      quiet,
    );
    await refineCategory('Zorblax');
    expect(peekModelOutcomes()).toEqual([
      expect.objectContaining({ outcome: 'answered', category: 'drinks', model: null }),
    ]);
  });

  it('keeps nothing when the model was not asked: a blank title, no model, or an unavailable one', async () => {
    await refineCategory(TITLE);
    setOnDeviceModel(stubModel(async () => said('food')).model, quiet);
    await refineCategory('   ');
    setOnDeviceModel(
      stubModel(
        async () => said('food'),
        async () => ({ status: 'unavailable', reason: 'appleIntelligenceNotEnabled' }),
      ).model,
      quiet,
    );
    await refineCategory(TITLE);
    expect(peekModelOutcomes()).toEqual([]);
  });

  it('a refiner of its own keeps nothing unless given a sink, and a sink that throws costs nothing', async () => {
    const { refine } = createCategoryRefiner(stubModel(async () => said('drinks')).model, quiet);
    await refine(TITLE);
    expect(peekModelOutcomes()).toEqual([]);
    const throwing = createCategoryRefiner(
      stubModel(async () => said('drinks')).model,
      quiet,
      () => {
        throw new Error('ring gone');
      },
    );
    await expect(throwing.refine(TITLE)).resolves.toBe('drinks');
  });

  it('tells a subscriber as each reply arrives, and stops when it unsubscribes', async () => {
    setOnDeviceModel(stubModel(async () => said('coffee')).model, quiet);
    let heard = 0;
    const off = subscribeModelOutcomes(() => {
      heard += 1;
    });
    await refineCategory('Nourish');
    await refineCategory('Nourish Bistro');
    off();
    await refineCategory('Nourish Bistro dinner');
    expect(heard).toBe(2);
    expect(peekModelOutcomes()).toHaveLength(3);
  });
});

describe('the model for Diagnostics (installedOnDeviceModel, categoryModelAvailability)', () => {
  afterEach(() => setOnDeviceModel(null));

  it('has no model and no availability while none is installed', async () => {
    expect(installedOnDeviceModel()).toBeNull();
    await expect(categoryModelAvailability()).resolves.toBeNull();
  });

  it('asks the installed model afresh each time, and checks what it says', async () => {
    let answer: unknown = { status: 'available' };
    const stub = stubModel(
      async () => said('food'),
      async () => answer as Awaited<ReturnType<OnDeviceModel['availability']>>,
    );
    setOnDeviceModel(stub.model, () => undefined);
    expect(installedOnDeviceModel()).toBe(stub.model);
    await expect(categoryModelAvailability()).resolves.toEqual({ status: 'available' });
    answer = { status: 'unavailable', reason: 'modelNotReady' };
    await expect(categoryModelAvailability()).resolves.toEqual({
      status: 'unavailable',
      reason: 'modelNotReady',
    });
    answer = { status: 'unavailable', reason: 'not a word!' };
    await expect(categoryModelAvailability()).resolves.toEqual({
      status: 'unavailable',
      reason: 'unknown',
    });
    expect(stub.availabilityCalls()).toBe(3);
  });

  it('a failed check is unavailable with checkFailed', async () => {
    setOnDeviceModel(
      stubModel(
        async () => said('food'),
        () => Promise.reject(new Error('gone')),
      ).model,
      () => undefined,
    );
    await expect(categoryModelAvailability()).resolves.toEqual({
      status: 'unavailable',
      reason: 'checkFailed',
    });
  });

  it('readAvailability: available, a reason that is a word, else unknown; malformed is unavailable', () => {
    expect(readAvailability({ status: 'available', reason: 'x' })).toEqual({ status: 'available' });
    expect(readAvailability({ status: 'unavailable', reason: 'deviceNotEligible' })).toEqual({
      status: 'unavailable',
      reason: 'deviceNotEligible',
    });
    for (const value of [null, undefined, 'available', {}, { status: 'yes' }]) {
      expect(readAvailability(value)).toEqual({ status: 'unavailable', reason: 'unknown' });
    }
  });
});

describe('the gate: which local guesses the model decides', () => {
  it('a guess stands for a history hit or keywords of one category; the model decides nothing known or two categories', () => {
    expect(guessCategory('Hotel bar')).toEqual({ category: 'lodging', from: 'table', mixed: true });
    expect(guessCategory('Gas station snacks')).toMatchObject({ category: 'fuel', mixed: true });
    expect(guessCategory('Tip for the ski guide')).toMatchObject({ category: 'fees', mixed: true });
    // One category, however long the title: the table's hit stands (measured: asking undid right chips).
    expect(guessCategory('Train and Co Drama Theater')).toMatchObject({
      category: 'transit',
      mixed: false,
    });
    expect(guessCategory('Banff Upper Hot Springs')).toMatchObject({ mixed: false });
    // Keywords inside a longer one do not count ("bus" and "ticket" in "bus ticket").
    expect(guessCategory('Bus ticket to Jasper')).toMatchObject({
      category: 'transit',
      mixed: false,
    });
    for (const [title, asks] of [
      ['Hotel bar', true],
      ['Rundle', true],
      ['Fairmont Banff', false],
      ['Train and Co Drama Theater', false],
      ['Bus ticket to Jasper', false],
    ] as const) {
      expect([title, needsModel(guessCategory(title))]).toEqual([title, asks]);
      expect([title, shouldRefine(initialChip(''), title)]).toEqual([title, asks]);
    }
    expect(shouldRefine(chipAfterTap(initialChip(''), 'drinks'), 'Hotel bar')).toBe(false);
  });

  it('a history hit stands even when the table would find two categories', () => {
    setCategoryHistory(() => [groupWith(['Hotel bar', 'drinks'])]);
    try {
      expect(guessCategory('Hotel bar')).toEqual({
        category: 'drinks',
        from: 'history',
        mixed: false,
      });
      expect(shouldRefine(initialChip(''), 'Hotel bar')).toBe(false);
    } finally {
      setCategoryHistory(null);
    }
  });

  it("the model's pick holds while a two-category title goes on, and a title that stands replaces it", () => {
    const model = chipAfterReply(chipAfterTitle(initialChip(''), 'Hotel bar'), 'Hotel bar', {
      askedTitle: 'Hotel bar',
      category: 'drinks',
    });
    expect(model).toEqual({ category: 'drinks', source: 'model', answeredTitle: 'Hotel bar' });
    expect(chipAfterTitle(model, 'Hotel bar ')).toBe(model);
    expect(chipAfterTitle(model, 'Hotel bar t')).toBe(model);
    // Backspaced to "Hotel": the table's lodging stands, at once.
    expect(chipAfterTitle(model, 'Hotel')).toEqual({ category: 'lodging', source: 'keyword' });
  });
});

describe('prepareCategoryModel (Add expense opened)', () => {
  const quiet = () => undefined;
  afterEach(() => setOnDeviceModel(null));
  const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

  it('prewarms an available model, sharing the one availability check with refineCategory', async () => {
    const stub = stubModel(async () => said('drinks'));
    setOnDeviceModel(stub.model, quiet);
    prepareCategoryModel();
    await settle();
    expect(stub.prewarms()).toBe(1);
    await expect(refineCategory("Surly's brewing")).resolves.toBe('drinks');
    expect(stub.availabilityCalls()).toBe(1);
  });

  it('does not prewarm an unavailable model, and nothing throws without a model or a prewarm', async () => {
    const stub = stubModel(
      async () => said('food'),
      async () => ({ status: 'unavailable', reason: 'deviceNotEligible' }),
    );
    setOnDeviceModel(stub.model, quiet);
    prepareCategoryModel();
    await settle();
    expect(stub.prewarms()).toBe(0);

    setOnDeviceModel(null);
    expect(() => prepareCategoryModel()).not.toThrow();

    const { prewarm: _, ...noPrewarm } = stubModel(async () => said('food')).model;
    setOnDeviceModel(noPrewarm, quiet);
    expect(() => prepareCategoryModel()).not.toThrow();

    const failing = stubModel(async () => said('food')).model;
    setOnDeviceModel({ ...failing, prewarm: () => Promise.reject(new Error('no model')) }, quiet);
    prepareCategoryModel();
    await settle();
    await expect(refineCategory('Nourish')).resolves.toBe('food');
  });
});

describe('the native module (modules/even-classifier)', () => {
  it('constrains the iOS model to exactly the sixteen category ids, in order', () => {
    const swift = sources('ios', '.swift').join('\n');
    const generable = /@Generable\s+enum ExpenseCategory: String, CaseIterable \{([^}]*)\}/.exec(
      swift,
    );
    expect(generable).not.toBeNull();
    const cases = [...(generable?.[1] ?? '').matchAll(/^\s*case (\w+)\s*$/gm)].map((m) => m[1]);
    expect(cases).toEqual([...CATEGORIES]);
  });

  it('only ever uses the on-device model: no Private Cloud Compute, no other model, no network', () => {
    const native = [...sources('ios', '.swift'), ...sources('android', '.kt')].join('\n');
    // Sessions are made only from `systemModel`, which returns the on-device system model as is or made for content
    // tagging, and nothing else.
    const systemModel =
      /static func systemModel\([^)]*\) -> SystemLanguageModel \{([\s\S]*?)\n {2}\}/.exec(native);
    expect(systemModel).not.toBeNull();
    const returned = [...(systemModel?.[1] ?? '').matchAll(/return ([^\n]+)/g)].map((m) => m[1]);
    expect(returned).toEqual([
      'SystemLanguageModel.default',
      'SystemLanguageModel(useCase: .contentTagging)',
    ]);
    for (const forbidden of [
      /PrivateCloudCompute/,
      /LanguageModelSession\((?!model: systemModel\()/,
      /SystemLanguageModel\((?!useCase: \.contentTagging\))/,
      /: (any |some )?LanguageModel\b/,
      /URLSession|URLRequest|HttpURLConnection|OkHttp/,
    ]) {
      expect(native).not.toMatch(forbidden);
    }
  });

  it('words an error by its case or its type, never its message, which may quote the prompt', () => {
    const swift = sources('ios', '.swift').join('\n');
    // `describe` is where every error becomes the reply's `detail` and the log's `detail=`.
    const body =
      /static func describe\(_ error: any Error\) -> \(ExpenseClassifierOutcome, String\) \{([\s\S]*?)\n {2}\}/.exec(
        swift,
      )?.[1];
    expect(body).toBeDefined();
    const returned = [...(body ?? '').matchAll(/return (\(\.\w+, [^\n]*?\))(?= *\}?$)/gm)].map(
      (m) => m[1],
    );
    expect(returned.length).toBeGreaterThanOrEqual(10);
    expect(returned).toHaveLength([...(body ?? '').matchAll(/\breturn\b/g)].length);
    for (const value of returned) {
      expect(value).toMatch(/^\(\.\w+, ("[A-Za-z]+"|String\(describing: type\(of: error\)\))\)$/);
    }
    for (const forbidden of [
      /localizedDescription|debugDescription|failureReason|recoverySuggestion/,
      /String\((describing|reflecting): error\)/,
      /\\\(error\b/,
    ]) {
      expect(swift).not.toMatch(forbidden);
    }
  });

  it('never puts the title in a native log line', () => {
    const swift = sources('ios', '.swift').join('\n');
    const calls = [...swift.matchAll(/\blog\.\w+\(([\s\S]*?)\)\n/g)].map((m) => m[1]);
    expect(calls.length).toBeGreaterThanOrEqual(4);
    for (const call of calls) expect(call).not.toMatch(/title|trimmed|prompt|error\)/i);
    expect(swift).not.toMatch(/\bprint\(|NSLog\(|os_log\(/);
  });
});
