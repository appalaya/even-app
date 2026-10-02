/**
 * even-crypto: XChaCha20-Poly1305 (IETF) seal and open in native code, so a large group opens in milliseconds
 * instead of seconds (pre-launch review H3, design.md "Crypto"). iOS uses libsodium. The app reaches it only through
 * `src/services/crypto/nativeAead.ts`, which checks it against @noble before installing it.
 */
export { default } from './src/EvenCryptoModule';
export * from './src/EvenCrypto.types';
