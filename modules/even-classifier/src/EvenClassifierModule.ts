import { NativeModule, requireOptionalNativeModule } from 'expo';

import type { ClassifierAvailability, ClassifierReply } from './EvenClassifier.types';

declare class EvenClassifierModule extends NativeModule {
  /**
   * The on-device model's category for `title` and what became of the request (`ClassifierReply`): a category, the
   * model's `other`, a refusal, a timeout (6 s on iOS, a retry included), an error, or no model. Never rejects on
   * purpose; callers still validate every field.
   */
  classifyExpense(title: string): Promise<ClassifierReply>;
  availability(): Promise<ClassifierAvailability>;
  /** Loads the model ahead of the first title (Add expense opening); a no-op when it is unavailable. */
  prewarm(): Promise<void>;
}

/** Null where the native module is not in the build (web, or a binary built before it existed): no model, then. */
export default requireOptionalNativeModule<EvenClassifierModule>('EvenClassifier');
