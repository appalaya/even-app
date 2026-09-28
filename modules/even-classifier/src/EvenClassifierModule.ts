import { NativeModule, requireOptionalNativeModule } from 'expo';

import type { ClassifierAvailability } from './EvenClassifier.types';

declare class EvenClassifierModule extends NativeModule {
  /**
   * One of Even's category ids for `title` from the on-device model, or null (no model, a refusal, an error, or no
   * answer within the native timeout). Never rejects on purpose; callers still validate the id.
   */
  classifyExpense(title: string): Promise<string | null>;
  availability(): Promise<ClassifierAvailability>;
  /** Loads the model ahead of the first title (Add expense opening); a no-op when it is unavailable. */
  prewarm(): Promise<void>;
}

/** Null where the native module is not in the build (web, or a binary built before it existed): no model, then. */
export default requireOptionalNativeModule<EvenClassifierModule>('EvenClassifier');
