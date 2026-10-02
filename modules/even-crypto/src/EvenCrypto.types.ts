/** Which library does the work, for the startup log and Diagnostics. Never secret. */
export interface EvenCryptoInfo {
  /** `libsodium` (iOS) or `tink` (Android). */
  library: string;
  /** The library's own version string. */
  version: string;
}
