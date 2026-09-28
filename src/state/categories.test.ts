import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { CATEGORIES, inferCategory as coreInfer, type Category, type GroupState } from '@even/core';
import { afterEach, describe, expect, it } from 'vitest';

import {
  carriesSparkle,
  chipAfterReply,
  chipAfterTap,
  chipAfterTitle,
  createCategoryRefiner,
  guessCategory,
  inferCategory,
  initialChip,
  prepareCategoryModel,
  refineCategory,
  setCategoryHistory,
  setOnDeviceModel,
  shouldRefine,
  type OnDeviceModel,
} from './categories';

/** A stub on-device model that records what it was asked. */
function stubModel(
  answer: (title: string) => Promise<string | null>,
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
    expect(applied).toEqual({ category: 'lodging', source: 'model' });
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
    expect(first).toEqual({ category: 'lodging', source: 'model' });
    expect(shouldRefine(first, 'Sunshine')).toBe(true);
    const refined = chipAfterReply(first, 'Sunshine', {
      askedTitle: 'Sunshine',
      category: 'activities',
    });
    expect(refined).toEqual({ category: 'activities', source: 'model' });
    // The same answer again changes nothing.
    expect(
      chipAfterReply(refined, 'Sunshine', { askedTitle: 'Sunshine', category: 'activities' }),
    ).toBe(refined);
    // A stale model reply is still dropped.
    expect(
      chipAfterReply(refined, 'Sunshine lift', { askedTitle: 'Sunshine', category: 'lodging' }),
    ).toBe(refined);
  });

  it('a keystroke after a model answer re-infers from the table, as a keyword chip', () => {
    const model = chipAfterReply(initialChip('Nourish'), 'Nourish', {
      askedTitle: 'Nourish',
      category: 'food',
    });
    expect(model).toEqual({ category: 'food', source: 'model' });
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

  it("the sparkle marks the model's pick until a tap or a keystroke, and nothing else", () => {
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
    // A tap, even on the model's own pick, and a keystroke both take it away.
    expect(carriesSparkle(chipAfterTap(model, 'drinks'))).toBe(false);
    expect(carriesSparkle(chipAfterTitle(model, "Surly's brewing co"))).toBe(false);
    expect(carriesSparkle(initialChip('Uber', 'food'))).toBe(false);
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
    expect(guessCategory('Nourish')).toEqual({ category: 'food', from: 'history' });
    expect(guessCategory('uber')).toEqual({ category: 'food', from: 'history' }); // a saved choice beats the table
    expect(guessCategory('Uber Eats')).toEqual({ category: 'food', from: 'table' });
    expect(guessCategory('Gas')).toEqual({ category: 'fuel', from: 'table' });
    expect(guessCategory('Rundle')).toEqual({ category: 'other', from: 'none' });
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
    expect(guessCategory('Nourish')).toEqual({ category: 'other', from: 'none' });
    setCategoryHistory(() => {
      throw new Error('not open yet');
    });
    expect(guessCategory('Gas')).toEqual({ category: 'fuel', from: 'table' });
    setCategoryHistory(() => []);
    expect(inferCategory('Parkade')).toBe(coreInfer('Parkade'));
  });
});

describe('refineCategory (the on-device model)', () => {
  afterEach(() => setOnDeviceModel(null));

  it('has no answer while no model is installed', async () => {
    await expect(refineCategory("Surly's brewing")).resolves.toBeNull();
  });

  it("returns the installed model's answer when it is one of the sixteen categories", async () => {
    const stub = stubModel(async (title) => (title === "Surly's brewing" ? 'drinks' : 'lodging'));
    setOnDeviceModel(stub.model);
    await expect(refineCategory("Surly's brewing")).resolves.toBe('drinks');
    await expect(refineCategory('Fairmont Banff Springs')).resolves.toBe('lodging');
    expect(stub.asked).toEqual(["Surly's brewing", 'Fairmont Banff Springs']);
  });

  it('maps anything that is not a category id to null', async () => {
    for (const answer of [
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
        stubModel(async () => answer as string | null).model,
      );
      await expect(refine("Surly's brewing")).resolves.toBeNull();
    }
  });

  it('treats a rejection or a throw as no answer', async () => {
    const { refine: rejects } = createCategoryRefiner(
      stubModel(() => Promise.reject(new Error('guardrail'))).model,
    );
    await expect(rejects("Surly's brewing")).resolves.toBeNull();
    const { refine: throws } = createCategoryRefiner(
      stubModel(() => {
        throw new Error('native module gone');
      }).model,
    );
    await expect(throws("Surly's brewing")).resolves.toBeNull();
  });

  it('does not ask about a blank title', async () => {
    const stub = stubModel(async () => 'food');
    const { refine } = createCategoryRefiner(stub.model);
    await expect(refine('   ')).resolves.toBeNull();
    expect(stub.asked).toEqual([]);
    expect(stub.availabilityCalls()).toBe(0);
  });

  it('asks for availability once per session and keeps the answer', async () => {
    const stub = stubModel(async () => 'activities');
    const { refine } = createCategoryRefiner(stub.model);
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
      async () => 'food',
      async () => ({ status: 'unavailable', reason: 'appleIntelligenceNotEnabled' }),
    );
    const { refine } = createCategoryRefiner(stub.model);
    await expect(refine('Nourish Bistro')).resolves.toBeNull();
    await expect(refine('Nourish Bistro dinner')).resolves.toBeNull();
    expect(stub.availabilityCalls()).toBe(1);
    expect(stub.asked).toEqual([]);
  });

  it('treats a failed availability check as unavailable, without retrying', async () => {
    const stub = stubModel(
      async () => 'food',
      () => Promise.reject(new Error('no native module')),
    );
    const { refine } = createCategoryRefiner(stub.model);
    await expect(refine('Nourish')).resolves.toBeNull();
    await expect(refine('Nourish Bistro')).resolves.toBeNull();
    expect(stub.availabilityCalls()).toBe(1);
    expect(stub.asked).toEqual([]);
  });

  it('starts a fresh session when a model is installed again', async () => {
    const unavailable = stubModel(
      async () => 'food',
      async () => ({ status: 'unavailable', reason: 'modelNotReady' }),
    );
    setOnDeviceModel(unavailable.model);
    await expect(refineCategory('Nourish')).resolves.toBeNull();
    const ready = stubModel(async () => 'food');
    setOnDeviceModel(ready.model);
    await expect(refineCategory('Nourish')).resolves.toBe('food');
  });
});

describe('prepareCategoryModel (Add expense opened)', () => {
  afterEach(() => setOnDeviceModel(null));
  const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

  it('prewarms an available model, sharing the one availability check with refineCategory', async () => {
    const stub = stubModel(async () => 'drinks');
    setOnDeviceModel(stub.model);
    prepareCategoryModel();
    await settle();
    expect(stub.prewarms()).toBe(1);
    await expect(refineCategory("Surly's brewing")).resolves.toBe('drinks');
    expect(stub.availabilityCalls()).toBe(1);
  });

  it('does not prewarm an unavailable model, and nothing throws without a model or a prewarm', async () => {
    const stub = stubModel(
      async () => 'food',
      async () => ({ status: 'unavailable', reason: 'deviceNotEligible' }),
    );
    setOnDeviceModel(stub.model);
    prepareCategoryModel();
    await settle();
    expect(stub.prewarms()).toBe(0);

    setOnDeviceModel(null);
    expect(() => prepareCategoryModel()).not.toThrow();

    const { prewarm: _, ...noPrewarm } = stubModel(async () => 'food').model;
    setOnDeviceModel(noPrewarm);
    expect(() => prepareCategoryModel()).not.toThrow();

    const failing = stubModel(async () => 'food').model;
    setOnDeviceModel({ ...failing, prewarm: () => Promise.reject(new Error('no model')) });
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
    expect(native).toContain('SystemLanguageModel.default');
    for (const forbidden of [
      /PrivateCloudCompute/,
      /LanguageModelSession\((?!model: SystemLanguageModel\.default,)/,
      /URLSession|URLRequest|HttpURLConnection|OkHttp/,
    ]) {
      expect(native).not.toMatch(forbidden);
    }
  });
});
