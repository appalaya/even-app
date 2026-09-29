/**
 * Diagnostics' live parts: the model's availability, asked afresh when the page opens, and "Check the model"
 * (`runModelCheck` over the bundled titles), which stops when the page goes away.
 */
import { useCallback, useEffect, useRef, useState } from 'react';

import { categoryModelAvailability, type OnDeviceModel } from '@/state/categories';

import type { ClassifierAvailability } from '../../../modules/even-classifier/src/EvenClassifier.types';
import { EVAL_CASES } from './evalCases';
import { runModelCheck, type CheckSignal, type ModelCheckResult } from './modelCheck';

/** The model's availability: undefined while it is asked, null when the build has no model. */
export function useModelAvailability(): ClassifierAvailability | null | undefined {
  const [availability, setAvailability] = useState<ClassifierAvailability | null | undefined>();
  useEffect(() => {
    let live = true;
    void categoryModelAvailability().then((value) => {
      if (live) setAvailability(value);
    });
    return () => {
      live = false;
    };
  }, []);
  return availability;
}

export type ModelCheckState =
  | { phase: 'idle' }
  | { phase: 'running'; done: number; total: number }
  | { phase: 'done'; result: ModelCheckResult };

/** The run in progress anywhere in the app: starting another stops it, so two never ask the model at once. */
let current: { aborted: boolean } | null = null;

/**
 * "Check the model": `start` runs every bundled title through `model`, one at a time, with progress; while a run
 * is going `start` does nothing; once it is done, `start` runs it again from the top. Leaving the page stops it
 * (no further title is asked; the reply in flight is dropped).
 */
export function useModelCheck(model: OnDeviceModel | null): {
  state: ModelCheckState;
  start: () => void;
} {
  const [state, setState] = useState<ModelCheckState>({ phase: 'idle' });
  const mine = useRef<{ aborted: boolean } | null>(null);
  const running = useRef(false);

  useEffect(
    () => () => {
      if (mine.current !== null) mine.current.aborted = true;
    },
    [],
  );

  const start = useCallback(() => {
    if (model === null || running.current) return;
    if (current !== null) current.aborted = true;
    const signal: { aborted: boolean } = { aborted: false };
    current = signal;
    mine.current = signal;
    running.current = true;
    setState({ phase: 'running', done: 0, total: EVAL_CASES.length });
    const stopped: CheckSignal = signal;
    void runModelCheck(EVAL_CASES, (title) => model.classifyExpense(title), {
      signal: stopped,
      onProgress: (done, total) => {
        if (!signal.aborted) setState({ phase: 'running', done, total });
      },
    })
      .then(
        (result) => {
          if (mine.current !== signal) return;
          setState(result === null ? { phase: 'idle' } : { phase: 'done', result });
        },
        () => {
          if (mine.current === signal) setState({ phase: 'idle' });
        },
      )
      .finally(() => {
        if (mine.current === signal) running.current = false;
        if (current === signal) current = null;
      });
  }, [model]);

  return { state, start };
}
