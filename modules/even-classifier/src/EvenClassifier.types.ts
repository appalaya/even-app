/**
 * Whether the phone's on-device model can answer. `reason` is the platform's word for why not: on iOS
 * `deviceNotEligible`, `appleIntelligenceNotEnabled` or `modelNotReady` (Foundation Models), or `osTooOld`,
 * `frameworkMissing`; on Android `notBuilt` for now.
 */
export type ClassifierAvailability =
  { status: 'available' } | { status: 'unavailable'; reason: string };

/**
 * What became of a request (ExpenseClassifier.swift, `ExpenseClassifierOutcome`): a category other than `other`, the
 * model's `other`, a guardrail violation or refusal, no answer in time, another error, no model, or a blank title.
 */
export type ClassifierOutcome =
  'answered' | 'other' | 'refused' | 'timeout' | 'error' | 'unavailable' | 'blank';

/** `classifyExpense`'s reply. It never carries the title. */
export interface ClassifierReply {
  /** One of Even's category ids (`other` included), or null. Callers still validate it. */
  category: string | null;
  outcome: ClassifierOutcome;
  /** From the call to the reply, a retry included. */
  ms: number;
  /** The model whose attempt decided the outcome (`general`, `contentTagging`), or null when none was asked. */
  model: string | null;
  /** The unavailability reason, or the error's kind (`guardrailViolation`), or null. */
  detail?: string | null;
}
