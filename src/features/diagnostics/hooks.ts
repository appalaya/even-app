/**
 * Diagnostics' live parts: the model's availability, asked afresh when the page opens, and "Check the model"
 * (`startModelCheck` over the bundled titles), which stops when the page goes away or the app goes to the
 * background.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { AppState } from 'react-native';

import { categoryModelAvailability, type OnDeviceModel } from '@/state/categories';

import type { ClassifierAvailability } from '../../../modules/even-classifier/src/EvenClassifier.types';
import { EVAL_CASES } from './evalCases';
import { startModelCheck, type ModelCheckRun, type ModelCheckState } from './modelCheck';

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

export type { ModelCheckState } from './modelCheck';

/**
 * "Check the model": `start` runs every bundled title through `model`, one at a time, with progress; while a run
 * is going `start` does nothing; once it has ended, `start` runs it again from the top. Leaving the page stops it
 * (no further title is asked; the reply in flight is dropped). The app going to the background stops it too, and
 * the state is then `stopped` with the titles scored so far; each title has `TITLE_TIMEOUT_MS` to answer.
 */
export function useModelCheck(model: OnDeviceModel | null): {
  state: ModelCheckState;
  start: () => void;
} {
  const [state, setState] = useState<ModelCheckState>({ phase: 'idle' });
  const run = useRef<ModelCheckRun | null>(null);

  useEffect(() => () => run.current?.cancel(), []);

  const start = useCallback(() => {
    if (model === null || run.current?.running === true) return;
    run.current = startModelCheck(EVAL_CASES, (title) => model.classifyExpense(title), {
      appState: AppState,
      onState: setState,
    });
  }, [model]);

  return { state, start };
}
