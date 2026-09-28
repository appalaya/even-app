/**
 * Whether the phone's on-device model can answer. `reason` is the platform's word for why not: on iOS
 * `deviceNotEligible`, `appleIntelligenceNotEnabled` or `modelNotReady` (Foundation Models), or `osTooOld`,
 * `frameworkMissing`; on Android `notBuilt` for now.
 */
export type ClassifierAvailability =
  { status: 'available' } | { status: 'unavailable'; reason: string };
