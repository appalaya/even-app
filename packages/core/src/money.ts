/**
 * Money in integer minor units. Frozen ISO 4217 exponent table; BigInt split math.
 *
 * This module is the only place that converts between minor units and display (design.md, "Minor units, not
 * cents"). Everything below the formatting layer is an integer number of minor units.
 *
 * Splits (design.md, "Rounding"): splitWeighted is the UI's Equal mode, with an optional per-member multiplier and
 * extra amount (Splitwise's shares and adjustments); splitEqual is its all-ones case; splitByBasisPoints is Percent.
 * Exact amounts need no helper, only isValidSplit. All three give their leftover units one each, starting at
 * hash(seed) % k over the ascending ids of the k members taking part, so the leftover moves with the expense id.
 */

/**
 * ISO 4217 minor-unit exponent per alphabetic code (List One, as of 2026).
 *
 * Included: every active code, including the fund codes (BOV, CHE, CHW, CLF, COU, MXV, USN, UYI, UYW), plus the
 * codes withdrawn since 2024 (ANG → XCG, BGN → EUR, SLL → SLE, ZWL → ZWG) so a group that picked one keeps
 * validating. The table only ever grows: removing a code would invalidate stored events.
 *
 * Excluded: the codes whose minor unit ISO lists as "N.A." — precious metals (XAU, XAG, XPD, XPT), bond-market
 * units (XBA–XBD), XDR, XSU, XUA, the testing code XTS and "no currency" XXX. None is something a group splits a
 * dinner in, and ISO gives them no exponent to encode.
 *
 * Where CLDR (and therefore `Intl`) disagrees with ISO — e.g. IQD, LBP, IRR, MGA, RSD, YER — ISO wins; see formatMinor.
 */
export const CURRENCY_EXPONENTS: Readonly<Record<string, number>> = Object.freeze({
  AED: 2, AFN: 2, ALL: 2, AMD: 2, ANG: 2, AOA: 2, ARS: 2, AUD: 2, AWG: 2, AZN: 2,
  BAM: 2, BBD: 2, BDT: 2, BGN: 2, BHD: 3, BIF: 0, BMD: 2, BND: 2, BOB: 2, BOV: 2,
  BRL: 2, BSD: 2, BTN: 2, BWP: 2, BYN: 2, BZD: 2,
  CAD: 2, CDF: 2, CHE: 2, CHF: 2, CHW: 2, CLF: 4, CLP: 0, CNY: 2, COP: 2, COU: 2,
  CRC: 2, CUC: 2, CUP: 2, CVE: 2, CZK: 2,
  DJF: 0, DKK: 2, DOP: 2, DZD: 2,
  EGP: 2, ERN: 2, ETB: 2, EUR: 2,
  FJD: 2, FKP: 2,
  GBP: 2, GEL: 2, GHS: 2, GIP: 2, GMD: 2, GNF: 0, GTQ: 2, GYD: 2,
  HKD: 2, HNL: 2, HTG: 2, HUF: 2,
  IDR: 2, ILS: 2, INR: 2, IQD: 3, IRR: 2, ISK: 0,
  JMD: 2, JOD: 3, JPY: 0,
  KES: 2, KGS: 2, KHR: 2, KMF: 0, KPW: 2, KRW: 0, KWD: 3, KYD: 2, KZT: 2,
  LAK: 2, LBP: 2, LKR: 2, LRD: 2, LSL: 2, LYD: 3,
  MAD: 2, MDL: 2, MGA: 2, MKD: 2, MMK: 2, MNT: 2, MOP: 2, MRU: 2, MUR: 2, MVR: 2,
  MWK: 2, MXN: 2, MXV: 2, MYR: 2, MZN: 2,
  NAD: 2, NGN: 2, NIO: 2, NOK: 2, NPR: 2, NZD: 2,
  OMR: 3,
  PAB: 2, PEN: 2, PGK: 2, PHP: 2, PKR: 2, PLN: 2, PYG: 0,
  QAR: 2,
  RON: 2, RSD: 2, RUB: 2, RWF: 0,
  SAR: 2, SBD: 2, SCR: 2, SDG: 2, SEK: 2, SGD: 2, SHP: 2, SLE: 2, SLL: 2, SOS: 2,
  SRD: 2, SSP: 2, STN: 2, SVC: 2, SYP: 2, SZL: 2,
  THB: 2, TJS: 2, TMT: 2, TND: 3, TOP: 2, TRY: 2, TTD: 2, TWD: 2, TZS: 2,
  UAH: 2, UGX: 0, USD: 2, USN: 2, UYI: 0, UYU: 2, UYW: 4, UZS: 2,
  VED: 2, VES: 2, VND: 0, VUV: 0,
  WST: 2,
  XAF: 0, XCD: 2, XCG: 2, XOF: 0, XPF: 0,
  YER: 2,
  ZAR: 2, ZMW: 2, ZWG: 2, ZWL: 2,
});

const CODE_SHAPE = /^[A-Z]{3}$/;
const hasOwn = (obj: object, key: string): boolean => Object.prototype.hasOwnProperty.call(obj, key);

export function isCurrency(code: string): boolean {
  return typeof code === 'string' && CODE_SHAPE.test(code) && hasOwn(CURRENCY_EXPONENTS, code);
}

/** Throws RangeError on unknown code. */
export function exponentOf(code: string): number {
  const exp = isCurrency(code) ? CURRENCY_EXPONENTS[code] : undefined;
  if (exp === undefined) throw new RangeError(`Unknown ISO 4217 currency code: ${String(code)}`);
  return exp;
}

// ---------- Formatting ----------

const formatters = new Map<string, Intl.NumberFormat>();

function formatterFor(currency: string, exp: number, locale: string | undefined): Intl.NumberFormat {
  const key = `${locale ?? ''}|${currency}`;
  let nf = formatters.get(key);
  if (nf === undefined) {
    nf = new Intl.NumberFormat(locale, {
      style: 'currency',
      currency,
      minimumFractionDigits: exp,
      maximumFractionDigits: exp,
    });
    formatters.set(key, nf);
  }
  return nf;
}

/** Below this magnitude an amount has at most 15 significant digits, which survive a decimal → binary64 → decimal trip. */
const EXACT_VIA_NUMBER = 1_000_000_000_000_000n;

/**
 * Intl.NumberFormat with the ISO exponent passed explicitly as min/max fraction digits.
 *
 * Exactness: the decimal is built from the integer with BigInt and string ops — no floating division.
 * - |amount| < 10^15 (every amount within LIMITS, and any realistic balance): the decimal string has ≤ 15
 *   significant digits, so `Number(decimalString)` is the nearest double and Intl, rounding to `exp` fraction
 *   digits, reproduces it exactly. Intl does all the work (symbol, grouping, sign, numbering system).
 * - Larger safe integers (exp > 0): the pieces are spliced from `formatToParts` of two exactly-representable
 *   probes — `±(major + 0.5)` for sign, symbol and grouped integer (major < 2^52, so exact), and
 *   `0.<minor digits>` for the fraction digits in the locale's own numbering system. If the engine lacks
 *   `formatToParts`, falls back to the nearest double (off by at most one minor unit, only above 10^15).
 *
 * Throws RangeError on a non-safe-integer amount or unknown currency; Intl throws RangeError on a malformed locale.
 */
export function formatMinor(amount: number, currency: string, locale?: string): string {
  if (!Number.isSafeInteger(amount)) throw new RangeError(`formatMinor: amount must be a safe integer, got ${amount}`);
  const exp = exponentOf(currency);
  const nf = formatterFor(currency, exp, locale);
  if (exp === 0) return nf.format(amount === 0 ? 0 : amount); // normalise -0

  const negative = amount < 0;
  const abs = BigInt(negative ? -amount : amount);
  const scale = 10n ** BigInt(exp);
  const major = abs / scale;
  const minorDigits = (abs % scale).toString().padStart(exp, '0');
  const viaNumber = (): string => nf.format(Number(`${negative ? '-' : ''}${major.toString()}.${minorDigits}`));

  if (abs < EXACT_VIA_NUMBER) return viaNumber();

  if (typeof nf.formatToParts !== 'function') return viaNumber();
  const probe = Number(major) + 0.5;
  const whole = nf.formatToParts(negative ? -probe : probe);
  const fraction = nf.formatToParts(Number(`0.${minorDigits}`)).filter((p) => p.type === 'fraction');
  const wholeFractions = whole.filter((p) => p.type === 'fraction').length;
  const fractionDigits = fraction[0]?.value;
  if (wholeFractions !== 1 || fraction.length !== 1 || fractionDigits === undefined || !whole.some((p) => p.type === 'integer')) {
    return viaNumber(); // an engine whose formatToParts does not split the number properly
  }
  return whole.map((p) => (p.type === 'fraction' ? fractionDigits : p.value)).join('');
}

/**
 * Minor units as a plain decimal string with the currency's ISO exponent: `(123456, 'USD') → "1234.56"`,
 * `(5, 'JPY') → "5"`, `(1234, 'KWD') → "1.234"`, `(-5, 'USD') → "-0.05"`. No symbol, no grouping, no locale: for
 * machine-readable output (CSV) and editable amount fields, where formatMinor is for display.
 *
 * Exact for any safe integer, so for every amount within LIMITS: BigInt and string ops, no floating division.
 * Zero (and -0) has no sign. Throws RangeError on a non-safe-integer amount or unknown currency.
 */
export function minorToDecimal(amount: number, currency: string): string {
  if (!Number.isSafeInteger(amount)) throw new RangeError(`minorToDecimal: amount must be a safe integer, got ${amount}`);
  const exp = exponentOf(currency);
  const sign = amount < 0 ? '-' : '';
  const digits = BigInt(amount < 0 ? -amount : amount).toString();
  if (exp === 0) return `${sign}${digits}`;
  const padded = digits.padStart(exp + 1, '0');
  return `${sign}${padded.slice(0, -exp)}.${padded.slice(-exp)}`;
}

// ---------- Splits ----------

/** FNV-1a, 32-bit, over UTF-16 code units (identical to byte-wise FNV-1a for ASCII seeds such as expense ids). */
function fnv1a32(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

function toAmount(amount: number, fn: string): bigint {
  if (!Number.isSafeInteger(amount) || amount < 0) {
    throw new RangeError(`${fn}: amount must be a non-negative safe integer, got ${amount}`);
  }
  return BigInt(amount);
}

function checkSeed(seed: string, fn: string): void {
  if (typeof seed !== 'string') throw new TypeError(`${fn}: seed must be a string`);
}

/** Ascending by UTF-16 code units (default sort): deterministic on every engine, no locale. */
function sortedIds(ids: readonly string[]): string[] {
  return [...ids].sort();
}

/**
 * Adds one unit to `remainder` consecutive shares, starting at `hash(seed) % n` in ascending-id order and wrapping.
 * Callers guarantee 0 ≤ remainder < n, so nobody gets more than one extra unit.
 */
function distributeRemainder(shares: bigint[], remainder: bigint, seed: string): void {
  const n = shares.length;
  const start = fnv1a32(seed) % n;
  for (let i = 0; i < Number(remainder); i++) {
    const idx = (start + i) % n;
    shares[idx] = (shares[idx] ?? 0n) + 1n;
  }
}

/** Keys in ascending id order. Object.fromEntries defines own data properties, so an id like "__proto__" is safe. */
function toRecord(ids: readonly string[], shares: readonly bigint[]): Record<string, number> {
  return Object.fromEntries(ids.map((id, i) => [id, Number(shares[i] ?? 0n)]));
}

/**
 * floor(amount / n) each, remainder distributed one unit each starting at hash(seed) % n, in ascending member-id order.
 *
 * This is splitWeighted with every weight 1 and no extras (W = n, each share floor(amount / n), k = n), so it
 * delegates there after its own argument checks; a property test pins the equality.
 */
export function splitEqual(amount: number, memberIds: readonly string[], seed: string): Record<string, number> {
  toAmount(amount, 'splitEqual');
  checkSeed(seed, 'splitEqual');
  if (memberIds.length === 0) throw new RangeError('splitEqual: memberIds must be non-empty');
  if (memberIds.some((id) => typeof id !== 'string')) throw new TypeError('splitEqual: member ids must be strings');
  if (new Set(memberIds).size !== memberIds.length) throw new RangeError('splitEqual: memberIds must be unique');

  return splitWeighted(amount, Object.fromEntries(memberIds.map((id) => [id, { weight: 1 }])), seed);
}

const BPS_TOTAL = 10_000;

/**
 * bps values sum to 10000; floor(amount × bp / 10000) in BigInt, remainder distributed as in splitEqual but only
 * among the members with bp > 0: a member at 0% never owes a unit.
 *
 * The remainder is the sum of the fractional parts of the positive shares, so it is < k (the number of bp > 0 keys)
 * and nobody gets more than one extra unit. It goes one unit each to consecutive bp > 0 keys in ascending-id order,
 * starting at hash(seed) % k. With every bp positive this is exactly splitEqual's rule.
 */
export function splitByBasisPoints(amount: number, bps: Readonly<Record<string, number>>, seed: string): Record<string, number> {
  const total = toAmount(amount, 'splitByBasisPoints');
  checkSeed(seed, 'splitByBasisPoints');
  if (typeof bps !== 'object' || bps === null) throw new TypeError('splitByBasisPoints: bps must be an object');
  const entries = Object.entries(bps);
  if (entries.length === 0) throw new RangeError('splitByBasisPoints: bps must be non-empty');
  let sum = 0;
  for (const [id, bp] of entries) {
    if (typeof bp !== 'number' || !Number.isInteger(bp) || bp < 0 || bp > BPS_TOTAL) {
      throw new RangeError(`splitByBasisPoints: bp for ${id} must be an integer in 0..${BPS_TOTAL}, got ${String(bp)}`);
    }
    sum += bp;
  }
  if (sum !== BPS_TOTAL) throw new RangeError(`splitByBasisPoints: bps must sum to ${BPS_TOTAL}, got ${sum}`);

  const byId = new Map(entries);
  const ids = sortedIds([...byId.keys()]);
  const shares = ids.map((id) => (total * BigInt(byId.get(id) ?? 0)) / BigInt(BPS_TOTAL));
  const allocated = shares.reduce((a, b) => a + b, 0n);
  // Distribute over the positive-bp members only, then write their shares back in place.
  const positive = ids.flatMap((id, i) => ((byId.get(id) ?? 0) > 0 ? [i] : []));
  const positiveShares = positive.map((i) => shares[i] ?? 0n);
  distributeRemainder(positiveShares, total - allocated, seed);
  positive.forEach((i, j) => {
    shares[i] = positiveShares[j] ?? 0n;
  });
  return toRecord(ids, shares);
}

/** A member's part of an Equal-mode split: a multiplier (Splitwise's shares) and an amount on top (its adjustments). */
export interface WeightedShare {
  weight: number;
  extra?: number;
}

const isNonNegativeSafeInteger = (v: unknown): v is number => typeof v === 'number' && Number.isSafeInteger(v) && v >= 0;

/**
 * Extras come off the top; the remainder splits by integer weight (BigInt), leftover units distributed one each
 * starting at hash(seed) % k over the ascending ids of members with weight > 0. Result = share + extra.
 *
 * With R = amount − Σ extras and W = Σ weights, each share is floor(R × w / W) in BigInt (R × w may exceed 2⁵³).
 * The leftover R − Σ shares is the sum of the fractional parts of the weight > 0 shares, so it is < k and nobody
 * gets more than one extra unit: splitByBasisPoints' rule, with weights in place of basis points. A weight-0 member
 * gets exactly its extra (possibly 0) and never a leftover unit. Every member id is a key of the result.
 *
 * Throws RangeError unless: members is non-empty; each weight and each extra (default 0) is a non-negative safe
 * integer; Σ extras ≤ amount; and some weight is > 0, or Σ extras === amount exactly (the result is then the extras).
 */
export function splitWeighted(amount: number, members: Readonly<Record<string, WeightedShare>>, seed: string): Record<string, number> {
  const total = toAmount(amount, 'splitWeighted');
  checkSeed(seed, 'splitWeighted');
  if (typeof members !== 'object' || members === null || Array.isArray(members)) {
    throw new TypeError('splitWeighted: members must be an object of id → { weight, extra? }');
  }
  const entries = Object.entries(members);
  if (entries.length === 0) throw new RangeError('splitWeighted: members must be non-empty');

  const weights = new Map<string, bigint>();
  const extras = new Map<string, bigint>();
  let weightSum = 0n;
  let extraSum = 0n;
  for (const [id, share] of entries) {
    if (typeof share !== 'object' || share === null) {
      throw new RangeError(`splitWeighted: share for ${id} must be an object { weight, extra? }, got ${String(share)}`);
    }
    const { weight, extra = 0 } = share;
    if (!isNonNegativeSafeInteger(weight)) {
      throw new RangeError(`splitWeighted: weight for ${id} must be a non-negative safe integer, got ${String(weight)}`);
    }
    if (!isNonNegativeSafeInteger(extra)) {
      throw new RangeError(`splitWeighted: extra for ${id} must be a non-negative safe integer, got ${String(extra)}`);
    }
    weights.set(id, BigInt(weight));
    extras.set(id, BigInt(extra));
    weightSum += BigInt(weight);
    extraSum += BigInt(extra);
  }
  if (extraSum > total) {
    throw new RangeError(`splitWeighted: extras sum to ${extraSum.toString()}, more than the amount ${amount}`);
  }

  const ids = sortedIds([...weights.keys()]);
  const extraOf = (id: string): bigint => extras.get(id) ?? 0n;
  if (weightSum === 0n) {
    if (extraSum !== total) {
      throw new RangeError(
        `splitWeighted: every weight is 0, so the extras must sum to the amount; got ${extraSum.toString()} of ${amount}`,
      );
    }
    return toRecord(ids, ids.map(extraOf));
  }

  const rest = total - extraSum;
  const shares = ids.map((id) => (rest * (weights.get(id) ?? 0n)) / weightSum);
  const allocated = shares.reduce((a, b) => a + b, 0n);
  // Distribute over the weight > 0 members only, then write their shares back in place.
  const positive = ids.flatMap((id, i) => ((weights.get(id) ?? 0n) > 0n ? [i] : []));
  const positiveShares = positive.map((i) => shares[i] ?? 0n);
  distributeRemainder(positiveShares, rest - allocated, seed);
  positive.forEach((i, j) => {
    shares[i] = positiveShares[j] ?? 0n;
  });
  return toRecord(ids, ids.map((id, i) => (shares[i] ?? 0n) + extraOf(id)));
}

const MAX_SAFE = BigInt(Number.MAX_SAFE_INTEGER);

/** Σ values, summed in BigInt. Throws RangeError if a value or the total is not a safe integer. */
export function splitSum(split: Readonly<Record<string, number>>): number {
  let sum = 0n;
  for (const v of Object.values(split)) {
    if (!Number.isSafeInteger(v)) throw new RangeError(`splitSum: value must be a safe integer, got ${String(v)}`);
    sum += BigInt(v);
  }
  if (sum > MAX_SAFE || sum < -MAX_SAFE) throw new RangeError(`splitSum: total ${sum.toString()} is not a safe integer`);
  return Number(sum);
}

/** Non-empty, every value a non-negative safe integer, sum === amount. Total: returns false, never throws, on bad input. */
export function isValidSplit(amount: number, split: Readonly<Record<string, number>>): boolean {
  try {
    if (!Number.isSafeInteger(amount) || amount < 0) return false;
    if (typeof split !== 'object' || split === null || Array.isArray(split)) return false;
    const values: unknown[] = Object.values(split);
    if (values.length === 0) return false;
    let sum = 0n;
    for (const v of values) {
      if (typeof v !== 'number' || !Number.isSafeInteger(v) || v < 0) return false;
      sum += BigInt(v);
    }
    return sum === BigInt(amount);
  } catch {
    return false; // hostile getters / proxies
  }
}
