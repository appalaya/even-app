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
import {
  median,
  readEvalCases,
  runModelCheck,
  startModelCheck,
  TITLE_TIMEOUT_MS,
  type EvalCase,
  type ModelCheckOutcome,
  type ModelCheckResult,
  type ModelCheckState,
} from './modelCheck';

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

/** The result of a run that asked every title; fails on a stopped run. */
function done(outcome: ModelCheckOutcome): ModelCheckResult {
  if (outcome.status !== 'done') throw new Error(`expected done, got ${JSON.stringify(outcome)}`);
  return outcome.result;
}

/** A stub of React Native's `AppState`: `set` announces a change to the listeners there are. */
function stubAppState() {
  const listeners = new Set<(state: string) => void>();
  return {
    addEventListener(type: 'change', listener: (state: string) => void) {
      expect(type).toBe('change');
      listeners.add(listener);
      return { remove: () => listeners.delete(listener) };
    },
    set(state: string) {
      for (const listener of [...listeners]) listener(state);
    },
    listeners: () => listeners.size,
  };
}

/** A reply that never comes. */
const never = () => new Promise<unknown>(() => undefined);

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
    const result = done(await runModelCheck(CASES, model.classify, { pause: noPause }));
    expect(result.right).toBe(3);
    expect(result.total).toBe(5);
    expect(result.timedOut).toBe(0);
    expect(result.byCategory).toEqual([
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
    const result = done(await runModelCheck(cases, model.classify, { pause: noPause }));
    expect(result.byCategory).toEqual([
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
    const result = done(await runModelCheck(CASES, model.classify, { pause: noPause }));
    expect(result.right).toBe(5);
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
    const result = done(
      await runModelCheck(CASES, model.classify, {
        pause: noPause,
        clock: () => t,
        onProgress: (count, total) => progress.push(`${count}/${total}`),
      }),
    );
    expect(progress).toEqual(['1/5', '2/5', '3/5', '4/5', '5/5']);
    expect(result.medianMs).toBe(300);
  });

  it('stops when the signal says so: no further title is asked, and the outcome is stopped', async () => {
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
        onProgress: (count) => progress.push(count),
      }),
    ).resolves.toMatchObject({ status: 'stopped', of: 5, result: { right: 1, total: 1 } });
    expect(model.asked).toEqual(['Nourish Bistro', 'Hazy IPA']);
    expect(progress).toEqual([1]);
    // Already stopped: nothing is asked at all.
    const again = stub({});
    await expect(runModelCheck(CASES, again.classify, { signal })).resolves.toMatchObject({
      status: 'stopped',
      of: 5,
      result: { total: 0 },
    });
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
    expect(done(first).right).toBe(2);
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
    const result = done(
      await runModelCheck(CASES, (title) => model.classifyExpense(title), { pause: noPause }),
    );
    expect(result.total).toBe(5);
    expect(answer).toHaveBeenCalledTimes(1 + CASES.length);
    expect(peekModelOutcomes()).toBe(kept);
    expect(peekModelOutcomes()).toHaveLength(1);
    expect(log).toHaveBeenCalledTimes(lines);
  });

  it('an empty set asks nothing and has no median', async () => {
    const model = stub({});
    await expect(runModelCheck([], model.classify)).resolves.toEqual({
      status: 'done',
      result: { right: 0, total: 0, timedOut: 0, medianMs: null, byCategory: [] },
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

describe('runModelCheck: bounded', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('a title with no reply after 8 s (above the native 6 s) counts as timed out, and the run moves on', async () => {
    expect(TITLE_TIMEOUT_MS).toBe(8_000);
    vi.useFakeTimers();
    let late: ((value: unknown) => void) | undefined;
    const model = stub({
      'Nourish Bistro': async () => said('food'),
      'Hazy IPA': () =>
        new Promise((resolve) => {
          late = resolve; // the reply that never comes in time
        }),
      'Surly brewing': async () => said('drinks'),
      'Canada Post': async () => said(null, 'timeout'), // the native side's own timeout
      'Sunshine lift': async () => said('activities'),
    });
    const progress: number[] = [];
    let outcome: ModelCheckOutcome | undefined;
    void runModelCheck(CASES, model.classify, {
      pause: noPause,
      onProgress: (count) => progress.push(count),
    }).then((settled) => {
      outcome = settled;
    });

    await vi.advanceTimersByTimeAsync(TITLE_TIMEOUT_MS - 1);
    expect(model.asked).toEqual(['Nourish Bistro', 'Hazy IPA']);
    expect(progress).toEqual([1]);
    await vi.advanceTimersByTimeAsync(1);
    expect(model.asked).toEqual(CASES.map((c) => c.title));
    expect(outcome).toEqual({
      status: 'done',
      result: {
        right: 3,
        total: 5,
        timedOut: 2,
        medianMs: 0,
        byCategory: [
          { category: 'food', right: 1, total: 1 },
          { category: 'drinks', right: 1, total: 2 },
          { category: 'activities', right: 1, total: 1 },
          { category: 'other', right: 0, total: 1 },
        ],
      },
    });
    // The reply that comes after all changes nothing.
    const settled = outcome;
    late?.(said('drinks'));
    await vi.advanceTimersByTimeAsync(TITLE_TIMEOUT_MS);
    expect(outcome).toBe(settled);
    expect(progress).toEqual([1, 2, 3, 4, 5]);
  });

  it('the app going to the background stops the run at once: the titles scored so far, as stopped', async () => {
    vi.useFakeTimers();
    const app = stubAppState();
    const model = stub({
      'Nourish Bistro': async () => {
        app.set('inactive'); // Control Centre, a call: not the background, the run goes on
        app.set('active');
        return said('food');
      },
      'Hazy IPA': () => {
        app.set('background'); // while this title is out, and it would never answer
        return never();
      },
    });
    const progress: number[] = [];
    const outcome = await runModelCheck(CASES, model.classify, {
      pause: noPause,
      appState: app,
      onProgress: (count) => progress.push(count),
    });

    expect(outcome).toEqual({
      status: 'stopped',
      of: 5,
      result: {
        right: 1,
        total: 1,
        timedOut: 0,
        medianMs: 0,
        byCategory: [{ category: 'food', right: 1, total: 1 }],
      },
    });
    expect(vi.getTimerCount()).toBe(0); // not waiting out the title's timeout
    expect(model.asked).toEqual(['Nourish Bistro', 'Hazy IPA']);
    expect(progress).toEqual([1]);
    expect(app.listeners()).toBe(0);
  });

  it('the background between two titles: the next one is not asked', async () => {
    const app = stubAppState();
    const model = stub(
      Object.fromEntries(CASES.map((c) => [c.title, async () => said(c.category)])),
    );
    let pauses = 0;
    const outcome = await runModelCheck(CASES, model.classify, {
      appState: app,
      pause: async () => {
        pauses += 1;
        if (pauses === 3) app.set('background');
      },
    });
    expect(outcome).toMatchObject({ status: 'stopped', of: 5, result: { right: 3, total: 3 } });
    expect(model.asked).toEqual(CASES.slice(0, 3).map((c) => c.title));
    expect(app.listeners()).toBe(0);
  });

  it('a run that asks every title is done, and stops listening to the app state', async () => {
    const app = stubAppState();
    const model = stub({});
    const outcome = await runModelCheck(CASES, model.classify, { appState: app, pause: noPause });
    expect(outcome).toMatchObject({ status: 'done', result: { total: 5, timedOut: 5, right: 0 } });
    expect(app.listeners()).toBe(0);
    app.set('background'); // after the run: nothing to stop
    expect(app.listeners()).toBe(0);
  });
});

describe('startModelCheck (the page’s run)', () => {
  /** Starts a run and records every state it reports. */
  function started(
    classify: (title: string) => Promise<unknown>,
    app = stubAppState(),
  ): { states: ModelCheckState[]; run: ReturnType<typeof startModelCheck>; app: typeof app } {
    const states: ModelCheckState[] = [];
    const run = startModelCheck(CASES, classify, {
      appState: app,
      pause: noPause,
      onState: (state) => states.push(state),
    });
    return { states, run, app };
  }

  it('reports running with progress, then done', async () => {
    const model = stub(
      Object.fromEntries(CASES.map((c) => [c.title, async () => said(c.category)])),
    );
    const { states, run } = started(model.classify);
    expect(run.running).toBe(true);
    await vi.waitFor(() => expect(run.running).toBe(false));
    expect(
      states.map((s) => (s.phase === 'running' ? `running ${s.done}/${s.total}` : s.phase)),
    ).toEqual([
      'running 0/5',
      'running 1/5',
      'running 2/5',
      'running 3/5',
      'running 4/5',
      'running 5/5',
      'done',
    ]);
    expect(states.at(-1)).toMatchObject({ phase: 'done', result: { right: 5, total: 5 } });
  });

  it('the app going to the background ends it as stopped with the partial score, never done', async () => {
    const app = stubAppState();
    const model = stub({
      'Nourish Bistro': async () => said('food'),
      'Hazy IPA': async () => said('drinks'),
      'Surly brewing': () => {
        app.set('background');
        return never();
      },
    });
    const { states, run } = started(model.classify, app);
    await vi.waitFor(() => expect(run.running).toBe(false));
    expect(states.at(-1)).toEqual({
      phase: 'stopped',
      of: 5,
      result: expect.objectContaining({ right: 2, total: 2 }) as unknown as ModelCheckResult,
    });
    expect(states.some((s) => s.phase === 'done')).toBe(false);
    expect(model.asked).toHaveLength(3);
    expect(app.listeners()).toBe(0);
  });

  it('one run app-wide: starting another stops the first, which goes back to idle', async () => {
    let release: (() => void) | undefined;
    const first = stub({
      'Nourish Bistro': () =>
        new Promise((resolve) => {
          release = () => resolve(said('food'));
        }),
    });
    const second = stub({});
    const a = started(first.classify);
    await vi.waitFor(() => expect(first.asked).toHaveLength(1));
    const b = started(second.classify);
    release?.();
    await vi.waitFor(() => expect(a.run.running || b.run.running).toBe(false));
    expect(first.asked).toEqual(['Nourish Bistro']); // no further title once the second began
    expect(a.states.at(-1)).toEqual({ phase: 'idle' });
    expect(b.states.at(-1)).toMatchObject({ phase: 'done', result: { total: 5 } });
  });

  it('cancel (the page went away): no further title is asked and nothing more is reported', async () => {
    let release: (() => void) | undefined;
    const model = stub({
      'Nourish Bistro': () =>
        new Promise((resolve) => {
          release = () => resolve(said('food'));
        }),
    });
    const { states, run, app } = started(model.classify);
    await vi.waitFor(() => expect(model.asked).toHaveLength(1));
    run.cancel();
    release?.();
    await vi.waitFor(() => expect(run.running).toBe(false));
    expect(model.asked).toEqual(['Nourish Bistro']);
    expect(states).toEqual([{ phase: 'running', done: 0, total: 5 }]);
    expect(app.listeners()).toBe(0);
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
