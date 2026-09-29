/**
 * The labelled test titles "Check the model" runs: packages/core/src/categories.eval.json, every split, bundled
 * with the app (read with `readEvalCases`, so a malformed entry is left out rather than trusted).
 */
import evalSet from '../../../packages/core/src/categories.eval.json';

import { readEvalCases, type EvalCase } from './modelCheck';

export const EVAL_CASES: readonly EvalCase[] = Object.freeze(readEvalCases(evalSet));
