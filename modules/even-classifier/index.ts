/**
 * even-classifier: the on-device model behind the category chip (design.md "Model refinement"). iOS uses Apple's
 * Foundation Models system language model, on the phone only; Android has no model yet and reports unavailable.
 * The app reaches it only through `src/state/categories.ts`, which validates every answer.
 */
export { default } from './src/EvenClassifierModule';
export * from './src/EvenClassifier.types';
