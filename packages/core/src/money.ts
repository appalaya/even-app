/** Money in integer minor units. Frozen ISO 4217 exponent table; BigInt split math. */
export const CURRENCY_EXPONENTS: Readonly<Record<string, number>> = {};
export function isCurrency(code: string): boolean { throw new Error('not implemented'); }
/** Throws RangeError on unknown code. */
export function exponentOf(code: string): number { throw new Error('not implemented'); }
/** Intl.NumberFormat with the ISO exponent passed explicitly as min/max fraction digits. */
export function formatMinor(amount: number, currency: string, locale?: string): string { throw new Error('not implemented'); }
/** floor(amount / n) each, remainder distributed one unit each starting at hash(seed) % n, in ascending member-id order. */
export function splitEqual(amount: number, memberIds: readonly string[], seed: string): Record<string, number> { throw new Error('not implemented'); }
/** bps values sum to 10000; floor(amount × bp / 10000) in BigInt, remainder distributed as in splitEqual. */
export function splitByBasisPoints(amount: number, bps: Readonly<Record<string, number>>, seed: string): Record<string, number> { throw new Error('not implemented'); }
export function splitSum(split: Readonly<Record<string, number>>): number { throw new Error('not implemented'); }
/** Non-empty, every value a non-negative safe integer, sum === amount. */
export function isValidSplit(amount: number, split: Readonly<Record<string, number>>): boolean { throw new Error('not implemented'); }
