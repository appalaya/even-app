import { readFileSync } from 'node:fs';

import { CATEGORIES, type Category } from '@even/core';
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  clearModelOutcomes,
  peekModelOutcomes,
  refineCategory,
  setOnDeviceModel,
  type OnDeviceModel,
} from '@/state/categories';

import { EVAL_CASES } from './evalCases';
import { median, readEvalCases, runModelCheck, type EvalCase } from './modelCheck';

/** The native reply for an answer, or for another outcome with no category. */
function said(category: string | null, outcome = category === null ? 'error' : 'answered') {
  return { category, outcome, ms: 250, model: 'general', detail: null };
}

const CASES: EvalCase[] = [
  { title: 'Nourish Bistro', category: 'food' },
  { title: 'Hazy IPA', category: 'drinks' },
  { title: 'Surly brewing', category: 'drinks' },
  { title: 'Canada Post', category: 'other' },
  { title: 'Sunshine lift', category: 'activities' },
];

/** A stub model: answers from `answers` by title, tracks how many calls are in flight at once. */
function stub(answers: Record<string, () => Promise<unknown>>) {
  const asked: string[] = [];
  let inFlight = 0;
  let most = 0;
  const classify = async (title: string) => {
    asked.push(title);
    inFlight += 1;
    most = Math.max(most, inFlight);
    try {
      await Promise.resolve();
      const answer = answers[title];
      return answer === undefined ? said(null, 'timeout') : await answer();
    } finally {
      inFlight -= 1;
    }
  };
  return { classify, asked, most: () => most };
}

const noPause = async () => undefined;

describe('runModelCheck (Check the model)', () => {
  afterEach(() => {
    setOnDeviceModel(null);
    clearModelOutcomes();
  });

  it('scores each title against its label: overall, and per category in the app order', async () => {
    const model = stub({
      'Nourish Bistro': async () => said('food'),
      'Hazy IPA': async () => said('coffee'),
      'Surly brewing': async () => said('drinks'),
      'Canada Post': async () => said('other', 'other'),
      'Sunshine lift': async () => said(null, 'refused'),
    });
    const result = await runModelCheck(CASES, model.classify, { pause: noPause });
    expect(result).not.toBeNull();
    expect(result?.right).toBe(3);
    expect(result?.total).toBe(5);
    expect(result?.byCategory).toEqual([
      { category: 'food', right: 1, total: 1 },
      { category: 'drinks', right: 1, total: 2 },
      { category: 'activities', right: 0, total: 1 },
      { category: 'other', right: 1, total: 1 },
    ]);
    expect(model.asked).toEqual(CASES.map((c) => c.title));
  });

  it("counts the model's other as the answer other, and a malformed or failed reply as wrong", async () => {
    const cases: EvalCase[] = [
      { title: 'a', category: 'other' },
      { title: 'b', category: 'other' },
      { title: 'c', category: 'food' },
      { title: 'd', category: 'food' },
      { title: 'e', category: 'food' },
      { title: 'f', category: 'food' },
    ];
    const model = stub({
      a: async () => said('other', 'answered'),
      b: async () => said(null, 'other'),
      c: async () => said('Food'),
      d: async () => 'food',
      e: () => Promise.reject(new Error('native module gone')),
      f: () => {
        throw new Error('thrown');
      },
    });
    const result = await runModelCheck(cases, model.classify, { pause: noPause });
    expect(result?.byCategory).toEqual([
      { category: 'food', right: 0, total: 4 },
      { category: 'other', right: 2, total: 2 },
    ]);
    expect(model.asked).toHaveLength(6);
  });

  it('asks one title at a time, in order', async () => {
    const model = stub(
      Object.fromEntries(
        CASES.map((c) => [
          c.title,
          () => new Promise((resolve) => setTimeout(() => resolve(said(c.category)), 2)),
        ]),
      ),
    );
    const result = await runModelCheck(CASES, model.classify, { pause: noPause });
    expect(result?.right).toBe(5);
    expect(model.most()).toBe(1);
    expect(model.asked).toEqual(CASES.map((c) => c.title));
  });

  it('reports progress after each title, and the median time per title', async () => {
    let t = 0;
    const took = [400, 100, 300, 200, 6000];
    const model = stub(
      Object.fromEntries(
        CASES.map((c, i) => [
          c.title,
          async () => {
            t += took[i] ?? 0;
            return said(c.category);
          },
        ]),
      ),
    );
    const progress: string[] = [];
    const result = await runModelCheck(CASES, model.classify, {
      pause: noPause,
      clock: () => t,
      onProgress: (done, total) => progress.push(`${done}/${total}`),
    });
    expect(progress).toEqual(['1/5', '2/5', '3/5', '4/5', '5/5']);
    expect(result?.medianMs).toBe(300);
  });

  it('stops when the signal says so: no further title is asked, and the result is null', async () => {
    const signal = { aborted: false };
    const model = stub(
      Object.fromEntries(
        CASES.map((c, i) => [
          c.title,
          async () => {
            if (i === 1) signal.aborted = true; // the page goes away while the second title is out
            return said(c.category);
          },
        ]),
      ),
    );
    const progress: number[] = [];
    await expect(
      runModelCheck(CASES, model.classify, {
        pause: noPause,
        signal,
        onProgress: (done) => progress.push(done),
      }),
    ).resolves.toBeNull();
    expect(model.asked).toEqual(['Nourish Bistro', 'Hazy IPA']);
    expect(progress).toEqual([1]);
    // Already stopped: nothing is asked at all.
    const again = stub({});
    await expect(runModelCheck(CASES, again.classify, { signal })).resolves.toBeNull();
    expect(again.asked).toEqual([]);
  });

  it('gives the same result when run twice, and keeps nothing between runs', async () => {
    const model = stub({
      'Nourish Bistro': async () => said('food'),
      'Hazy IPA': async () => said('drinks'),
    });
    const first = await runModelCheck(CASES, model.classify, { pause: noPause, clock: () => 0 });
    const second = await runModelCheck(CASES, model.classify, { pause: noPause, clock: () => 0 });
    expect(second).toEqual(first);
    expect(first?.right).toBe(2);
  });

  it('never reaches the outcomes since launch or the log of the chip', async () => {
    const answer = vi.fn(async () => said('food'));
    const log = vi.fn();
    const model: OnDeviceModel = {
      availability: async () => ({ status: 'available' }),
      classifyExpense: answer,
    };
    setOnDeviceModel(model, log);
    await refineCategory('Dinner at Nourish'); // one real chip reply, for comparison
    const kept = peekModelOutcomes();
    const lines = log.mock.calls.length;
    const result = await runModelCheck(CASES, (title) => model.classifyExpense(title), {
      pause: noPause,
    });
    expect(result?.total).toBe(5);
    expect(answer).toHaveBeenCalledTimes(1 + CASES.length);
    expect(peekModelOutcomes()).toBe(kept);
    expect(peekModelOutcomes()).toHaveLength(1);
    expect(log).toHaveBeenCalledTimes(lines);
  });

  it('an empty set asks nothing and has no median', async () => {
    const model = stub({});
    await expect(runModelCheck([], model.classify)).resolves.toEqual({
      right: 0,
      total: 0,
      medianMs: null,
      byCategory: [],
    });
    expect(model.asked).toEqual([]);
  });

  it('does not block: it yields between titles', async () => {
    let pauses = 0;
    const model = stub({});
    await runModelCheck(CASES, model.classify, {
      pause: async () => {
        pauses += 1;
      },
    });
    expect(pauses).toBe(CASES.length);
  });
});

describe('median', () => {
  it('is the middle value, or the mean of the two middle ones', () => {
    expect(median([])).toBeNull();
    expect(median([7])).toBe(7);
    expect(median([5, 1, 3])).toBe(3);
    expect(median([4, 1, 3, 2])).toBe(2.5);
  });
});

describe('the bundled titles (categories.eval.json)', () => {
  const file = JSON.parse(
    readFileSync(
      new URL('../../../packages/core/src/categories.eval.json', import.meta.url),
      'utf8',
    ),
  ) as { cases: { title: string; category: string; split: string }[] };

  it('are every labelled title of every split, in file order', () => {
    expect(EVAL_CASES.length).toBe(file.cases.length);
    expect(new Set(file.cases.map((c) => c.split)).size).toBeGreaterThan(1);
    expect(EVAL_CASES.map((c) => c.title)).toEqual(file.cases.map((c) => c.title));
    expect(EVAL_CASES.map((c) => c.category)).toEqual(file.cases.map((c) => c.category));
  });

  it('cover every category', () => {
    const seen = new Set<Category>(EVAL_CASES.map((c) => c.category));
    for (const c of CATEGORIES) expect(seen.has(c)).toBe(true);
  });

  it('readEvalCases leaves out an entry with no title or a label that is not a category', () => {
    expect(
      readEvalCases({
        cases: [
          { title: 'Nourish', category: 'food', split: 'train' },
          { title: '', category: 'food' },
          { title: 'Nourish', category: 'Food' },
          { category: 'food' },
          null,
          'Nourish',
          { title: 'Canada Post', category: 'other' },
        ],
      }),
    ).toEqual([
      { title: 'Nourish', category: 'food' },
      { title: 'Canada Post', category: 'other' },
    ]);
    for (const set of [null, undefined, {}, { cases: 'no' }, []])
      expect(readEvalCases(set)).toEqual([]);
  });
});
