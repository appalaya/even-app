/** Random ids and bytes. Uses globalThis.crypto.getRandomValues; the app polyfills it at entry from expo-crypto. */
export function randomBytes(length: number): Uint8Array { throw new Error('not implemented'); }
/** 22-char base64url of 16 random bytes. Not time-ordered, on purpose. */
export function newId(): string { throw new Error('not implemented'); }
export function isId(text: string): boolean { throw new Error('not implemented'); }
