import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { LIMITS } from './constants.js';
import {
  CURRENCY_EXPONENTS,
  exponentOf,
  formatMinor,
  isCurrency,
  type CurrencyDisplay,
  isValidSplit,
  minorToDecimal,
  splitByBasisPoints,
  splitEqual,
  splitSum,
  splitWeighted,
  type WeightedShare,
} from './money.js';

/** Intl emits NBSP / narrow NBSP around symbols; compare on plain spaces. */
const norm = (s: string): string => s.replace(/\s/g, ' ');

/** Reference FNV-1a (32-bit over UTF-16 code units), written independently of money.ts in BigInt. */
function fnvRef(s: string): number {
  let h = 0x811c9dc5n;
  for (let i = 0; i < s.length; i++) {
    h ^= BigInt(s.charCodeAt(i));
    h = (h * 0x01000193n) & 0xffffffffn;
  }
  return Number(h);
}

/** Exact reference: Node's Intl accepts a decimal string and formats it without going through a double. */
function refFormat(amount: number, currency: string, locale: string, display: CurrencyDisplay = 'narrowSymbol'): string {
  const exp = CURRENCY_EXPONENTS[currency] ?? 0;
  const neg = amount < 0;
  const abs = BigInt(Math.abs(amount));
  const scale = 10n ** BigInt(exp);
  const dec = exp === 0 ? abs.toString() : `${abs / scale}.${(abs % scale).toString().padStart(exp, '0')}`;
  const digits = { minimumFractionDigits: exp, maximumFractionDigits: exp };
  const nf = display === 'none'
    ? new Intl.NumberFormat(locale, { style: 'decimal', ...digits })
    : new Intl.NumberFormat(locale, { style: 'currency', currency, currencyDisplay: display, ...digits });
  return nf.format(`${neg ? '-' : ''}${dec}` as unknown as number);
}

describe('CURRENCY_EXPONENTS', () => {
  it('is frozen and the size of the ISO list minus its 13 no-minor-unit codes, plus 4 recent withdrawals', () => {
    expect(Object.isFrozen(CURRENCY_EXPONENTS)).toBe(true);
    const n = Object.keys(CURRENCY_EXPONENTS).length;
    expect(n).toBeGreaterThanOrEqual(165);
    expect(n).toBeLessThanOrEqual(175);
  });

  it('has only uppercase 3-letter keys and exponents in {0, 2, 3, 4}', () => {
    for (const [code, exp] of Object.entries(CURRENCY_EXPONENTS)) {
      expect(code).toMatch(/^[A-Z]{3}$/);
      expect([0, 2, 3, 4]).toContain(exp);
    }
  });

  it.each([
    ['USD', 2], ['EUR', 2], ['CAD', 2], ['GBP', 2], ['CHF', 2], ['AUD', 2], ['MXN', 2], ['INR', 2],
    ['JPY', 0], ['KRW', 0], ['VND', 0], ['CLP', 0], ['ISK', 0], ['PYG', 0], ['UGX', 0], ['XAF', 0], ['XOF', 0], ['XPF', 0],
    ['HUF', 2], ['IDR', 2], ['TWD', 2], ['IRR', 2], ['MGA', 2], ['MRU', 2], ['LBP', 2], ['RSD', 2], ['COP', 2],
    ['KWD', 3], ['BHD', 3], ['OMR', 3], ['JOD', 3], ['TND', 3], ['LYD', 3], ['IQD', 3],
    ['UYW', 4], ['CLF', 4],
    ['XCG', 2], ['ZWG', 2], ['SLE', 2], ['VED', 2], ['STN', 2],
  ])('%s → %i', (code, exp) => {
    expect(CURRENCY_EXPONENTS[code]).toBe(exp);
    expect(exponentOf(code)).toBe(exp);
  });

  it('covers every currency Node’s Intl knows except the no-minor-unit codes', () => {
    const excluded = new Set(['XAU', 'XAG', 'XPD', 'XPT', 'XBA', 'XBB', 'XBC', 'XBD', 'XDR', 'XSU', 'XUA', 'XTS', 'XXX', 'HRK']);
    const missing = Intl.supportedValuesOf('currency').filter((c) => !excluded.has(c) && !isCurrency(c));
    expect(missing).toEqual([]);
  });
});

describe('isCurrency / exponentOf', () => {
  it('accepts known uppercase codes only', () => {
    expect(isCurrency('USD')).toBe(true);
    expect(isCurrency('JPY')).toBe(true);
    for (const bad of ['usd', 'Usd', 'US', 'USDD', '', ' USD', 'XAU', 'XXX', 'XTS', 'ABC', 'toString', '__proto__', 'constructor']) {
      expect(isCurrency(bad)).toBe(false);
    }
    expect(isCurrency(123 as unknown as string)).toBe(false);
  });

  it('exponentOf throws RangeError on unknown codes', () => {
    expect(() => exponentOf('usd')).toThrow(RangeError);
    expect(() => exponentOf('ABC')).toThrow(RangeError);
    expect(() => exponentOf('hasOwnProperty')).toThrow(RangeError);
  });
});

describe('formatMinor', () => {
  it('formats 10^12 minor units of USD exactly', () => {
    expect(formatMinor(1_000_000_000_000, 'USD', 'en-US')).toBe('$10,000,000,000.00');
    expect(formatMinor(1_000_000_000_000, 'USD', 'en-US', { display: 'narrowSymbol' })).toBe('$10,000,000,000.00');
    expect(formatMinor(1_000_000_000_000, 'USD', 'en-US', { display: 'none' })).toBe('10,000,000,000.00');
    expect(norm(formatMinor(1_000_000_000_000, 'CAD', 'en-US', { display: 'narrowSymbol' }))).toBe('$10,000,000,000.00');
    expect(norm(formatMinor(1_000_000_000_000, 'CAD', 'de-DE', { display: 'none' }))).toBe('10.000.000.000,00');
  });

  it('USD / CAD / JPY / KWD / EUR in en-US', () => {
    expect(formatMinor(123456, 'USD', 'en-US')).toBe('$1,234.56');
    expect(norm(formatMinor(150, 'CAD', 'en-US'))).toBe('$1.50');
    expect(formatMinor(1234567, 'JPY', 'en-US')).toBe('¥1,234,567');
    expect(norm(formatMinor(1234, 'KWD', 'en-US'))).toMatch(/^KWD 1\.234$/);
    expect(formatMinor(123456, 'EUR', 'en-US')).toBe('€1,234.56');
  });

  it('USD / CAD / JPY / KWD / EUR in de-DE', () => {
    const cases: Array<[number, string, string]> = [
      [123456, 'USD', '1.234,56'],
      [150, 'CAD', '1,50'],
      [1234567, 'JPY', '1.234.567'],
      [1234, 'KWD', '1,234'],
      [123456, 'EUR', '1.234,56'],
    ];
    for (const [amount, cur, digits] of cases) {
      const out = norm(formatMinor(amount, cur, 'de-DE'));
      expect(out.startsWith(`${digits} `)).toBe(true);
    }
    expect(norm(formatMinor(123456, 'EUR', 'de-DE'))).toBe('1.234,56 €');
  });

  it('shows the currency per display mode: USD / CAD / JPY / KWD / EUR in en-US, en-CA, de-DE', () => {
    const amounts: Array<[number, string]> = [[123456, 'USD'], [150, 'CAD'], [1234567, 'JPY'], [1234, 'KWD'], [123456, 'EUR']];
    const expected: Record<string, Record<CurrencyDisplay, string[]>> = {
      'en-US': {
        narrowSymbol: ['$1,234.56', '$1.50', '¥1,234,567', 'KWD 1.234', '€1,234.56'],
        symbol: ['$1,234.56', 'CA$1.50', '¥1,234,567', 'KWD 1.234', '€1,234.56'],
        code: ['USD 1,234.56', 'CAD 1.50', 'JPY 1,234,567', 'KWD 1.234', 'EUR 1,234.56'],
        none: ['1,234.56', '1.50', '1,234,567', '1.234', '1,234.56'],
      },
      'en-CA': {
        narrowSymbol: ['$1,234.56', '$1.50', '¥1,234,567', 'KWD 1.234', '€1,234.56'],
        symbol: ['US$1,234.56', '$1.50', 'JP¥1,234,567', 'KWD 1.234', '€1,234.56'],
        code: ['USD 1,234.56', 'CAD 1.50', 'JPY 1,234,567', 'KWD 1.234', 'EUR 1,234.56'],
        none: ['1,234.56', '1.50', '1,234,567', '1.234', '1,234.56'],
      },
      'de-DE': {
        narrowSymbol: ['1.234,56 $', '1,50 $', '1.234.567 ¥', '1,234 KWD', '1.234,56 €'],
        symbol: ['1.234,56 $', '1,50 CA$', '1.234.567 ¥', '1,234 KWD', '1.234,56 €'],
        code: ['1.234,56 USD', '1,50 CAD', '1.234.567 JPY', '1,234 KWD', '1.234,56 EUR'],
        none: ['1.234,56', '1,50', '1.234.567', '1,234', '1.234,56'],
      },
    };
    for (const [locale, byDisplay] of Object.entries(expected)) {
      for (const [display, outs] of Object.entries(byDisplay) as Array<[CurrencyDisplay, string[]]>) {
        const got = amounts.map(([amount, cur]) => norm(formatMinor(amount, cur, locale, { display })));
        expect([locale, display, got]).toEqual([locale, display, outs]);
      }
      // The default is narrowSymbol.
      const byDefault = amounts.map(([amount, cur]) => norm(formatMinor(amount, cur, locale)));
      expect(byDefault).toEqual(byDisplay.narrowSymbol);
      expect(amounts.map(([amount, cur]) => norm(formatMinor(amount, cur, locale, {})))).toEqual(byDisplay.narrowSymbol);
    }
  });

  it('keeps the sign and the exact large-amount path in every display mode', () => {
    expect(formatMinor(-123456, 'CAD', 'en-US', { display: 'none' })).toBe('-1,234.56');
    expect(norm(formatMinor(-150, 'CAD', 'de-DE', { display: 'code' }))).toBe('-1,50 CAD');
    expect(formatMinor(-0, 'JPY', 'en-US', { display: 'none' })).toBe('0');
    expect(formatMinor(Number.MAX_SAFE_INTEGER, 'USD', 'en-US', { display: 'none' })).toBe('90,071,992,547,409.91');
    expect(formatMinor(-Number.MAX_SAFE_INTEGER, 'CAD', 'en-US', { display: 'none' })).toBe('-90,071,992,547,409.91');
    expect(norm(formatMinor(-Number.MAX_SAFE_INTEGER, 'CAD', 'en-US', { display: 'code' }))).toBe('-CAD 90,071,992,547,409.91');
    expect(formatMinor(Number.MAX_SAFE_INTEGER, 'CAD', 'en-US', { display: 'symbol' })).toBe('CA$90,071,992,547,409.91');
    expect(norm(formatMinor(1_234_567_890_123_457, 'KWD', 'de-DE', { display: 'none' }))).toBe('1.234.567.890.123,457');
  });

  it('throws RangeError on an unknown display', () => {
    const bad = [{ display: 'name' }, { display: 'NONE' }, { display: '' }] as unknown as Array<{ display: CurrencyDisplay }>;
    for (const options of bad) expect(() => formatMinor(100, 'USD', 'en-US', options)).toThrow(RangeError);
  });

  it('falls back to the full symbol on an engine without narrowSymbol', () => {
    const holder = Intl as unknown as { NumberFormat: typeof Intl.NumberFormat };
    const Original = holder.NumberFormat;
    const Strict = function (locale?: string, opts?: Intl.NumberFormatOptions): Intl.NumberFormat {
      if (opts?.currencyDisplay === 'narrowSymbol') throw new RangeError('narrowSymbol is not supported');
      return new Original(locale, opts);
    } as unknown as typeof Intl.NumberFormat;
    holder.NumberFormat = Strict;
    try {
      // A locale / currency pair no other test formats, so the formatter cache holds nothing for it yet.
      expect(norm(formatMinor(150, 'NZD', 'en-AU'))).toBe(norm(refFormat(150, 'NZD', 'en-AU', 'symbol')));
      expect(() => formatMinor(150, 'NZD', 'not a locale!')).toThrow(RangeError);
    } finally {
      holder.NumberFormat = Original;
    }
  });

  it('uses the ISO exponent even where CLDR disagrees', () => {
    // CLDR shows IQD, LBP and MGA with 0 digits; ISO says 3, 2 and 2.
    expect(norm(formatMinor(1000, 'IQD', 'en-US'))).toContain('1.000');
    expect(norm(formatMinor(1000, 'LBP', 'en-US'))).toContain('10.00');
    expect(norm(formatMinor(1000, 'MGA', 'en-US'))).toContain('10.00');
    expect(norm(formatMinor(12345, 'CLF', 'en-US'))).toContain('1.2345');
    expect(norm(formatMinor(12345, 'UYW', 'en-US'))).toContain('1.2345');
  });

  it('formats negatives as negative, small magnitudes with leading zeros, and zero without a sign', () => {
    expect(formatMinor(-123456, 'USD', 'en-US')).toBe('-$1,234.56');
    expect(formatMinor(-1, 'USD', 'en-US')).toBe('-$0.01');
    expect(formatMinor(-5, 'KWD', 'en-US')).toContain('0.005');
    expect(formatMinor(-5, 'KWD', 'en-US')).toMatch(/^-/);
    expect(norm(formatMinor(-123456, 'EUR', 'de-DE'))).toBe('-1.234,56 €');
    expect(formatMinor(-1234, 'JPY', 'en-US')).toBe('-¥1,234');
    expect(formatMinor(0, 'USD', 'en-US')).toBe('$0.00');
    expect(formatMinor(-0, 'USD', 'en-US')).toBe('$0.00');
    expect(formatMinor(-0, 'JPY', 'en-US')).toBe('¥0');
  });

  it('is exact beyond 10^15 minor units, up to MAX_SAFE_INTEGER', () => {
    expect(formatMinor(Number.MAX_SAFE_INTEGER, 'USD', 'en-US')).toBe('$90,071,992,547,409.91');
    expect(formatMinor(-Number.MAX_SAFE_INTEGER, 'USD', 'en-US')).toBe('-$90,071,992,547,409.91');
    expect(norm(formatMinor(1_234_567_890_123_457, 'KWD', 'de-DE'))).toBe('1.234.567.890.123,457 KWD');
    expect(formatMinor(Number.MAX_SAFE_INTEGER, 'JPY', 'en-US')).toBe('¥9,007,199,254,740,991');
  });

  it('keeps the locale’s numbering system on the exact large-amount path', () => {
    const out = formatMinor(Number.MAX_SAFE_INTEGER, 'EUR', 'ar-EG');
    expect(out).toBe(refFormat(Number.MAX_SAFE_INTEGER, 'EUR', 'ar-EG'));
    const hi = formatMinor(1_234_567_890_123_456, 'INR', 'hi-IN-u-nu-deva');
    expect(hi).toBe(refFormat(1_234_567_890_123_456, 'INR', 'hi-IN-u-nu-deva'));
    expect(hi).not.toMatch(/[0-9]/);
  });

  it('matches an exact decimal-string reference for any safe integer, in every display mode (property)', () => {
    const currencies = ['USD', 'CAD', 'JPY', 'KWD', 'CLF', 'EUR'];
    const locales = ['en-US', 'en-CA', 'de-DE', 'fr-CH', 'ar-EG', 'ja-JP'];
    const displays: CurrencyDisplay[] = ['narrowSymbol', 'symbol', 'code', 'none'];
    fc.assert(
      fc.property(
        fc.oneof(fc.integer({ min: -LIMITS.amountMax, max: LIMITS.amountMax }), fc.maxSafeInteger(), fc.integer({ min: -1000, max: 1000 })),
        fc.constantFrom(...currencies),
        fc.constantFrom(...locales),
        fc.constantFrom(...displays),
        (amount, currency, locale, display) => {
          expect(formatMinor(amount, currency, locale, { display })).toBe(refFormat(amount, currency, locale, display));
          if (display === 'narrowSymbol') expect(formatMinor(amount, currency, locale)).toBe(refFormat(amount, currency, locale));
        },
      ),
      { numRuns: 1000 },
    );
  });

  it('still formats when the engine lacks formatToParts', () => {
    const proto = Intl.NumberFormat.prototype as unknown as { formatToParts: unknown };
    const original = proto.formatToParts;
    proto.formatToParts = undefined;
    try {
      expect(formatMinor(1_000_000_000_000_000, 'USD', 'en-US')).toBe('$10,000,000,000,000.00');
      expect(formatMinor(123456, 'USD', 'en-US')).toBe('$1,234.56');
    } finally {
      proto.formatToParts = original;
    }
  });

  it('throws RangeError on a non-safe-integer amount or unknown currency', () => {
    expect(() => formatMinor(1.5, 'USD', 'en-US')).toThrow(RangeError);
    expect(() => formatMinor(Number.NaN, 'USD', 'en-US')).toThrow(RangeError);
    expect(() => formatMinor(2 ** 53, 'USD', 'en-US')).toThrow(RangeError);
    expect(() => formatMinor(100, 'usd', 'en-US')).toThrow(RangeError);
    expect(() => formatMinor(100, 'XAU', 'en-US')).toThrow(RangeError);
  });

  it('uses the default locale when none is given', () => {
    expect(formatMinor(123456, 'USD')).toBe(new Intl.NumberFormat(undefined, {
      style: 'currency', currency: 'USD', currencyDisplay: 'narrowSymbol', minimumFractionDigits: 2, maximumFractionDigits: 2,
    }).format(1234.56));
    expect(formatMinor(123456, 'CAD', undefined, { display: 'none' })).toBe(new Intl.NumberFormat(undefined, {
      minimumFractionDigits: 2, maximumFractionDigits: 2,
    }).format(1234.56));
  });
});

describe('minorToDecimal', () => {
  it.each([
    [123456, 'USD', '1234.56'],
    [5, 'USD', '0.05'],
    [-5, 'USD', '-0.05'],
    [-123456, 'USD', '-1234.56'],
    [0, 'EUR', '0.00'],
    [-0, 'EUR', '0.00'],
    [5, 'JPY', '5'],
    [-1234, 'JPY', '-1234'],
    [0, 'JPY', '0'],
    [-0, 'JPY', '0'],
    [1234, 'KWD', '1.234'],
    [1, 'KWD', '0.001'],
    [-1, 'KWD', '-0.001'],
    [12345, 'CLF', '1.2345'],
    [1000, 'IQD', '1.000'],
    [1000, 'LBP', '10.00'],
  ])('(%i, %s) → %s', (amount, currency, out) => {
    expect(minorToDecimal(amount, currency)).toBe(out);
  });

  it('is exact at LIMITS.amountMax and up to MAX_SAFE_INTEGER, with no grouping or locale', () => {
    const max = BigInt(LIMITS.amountMax);
    expect(minorToDecimal(LIMITS.amountMax, 'USD')).toBe(`${max / 100n}.${(max % 100n).toString().padStart(2, '0')}`);
    expect(minorToDecimal(1_000_000_000_000, 'USD')).toBe('10000000000.00');
    expect(minorToDecimal(Number.MAX_SAFE_INTEGER, 'USD')).toBe('90071992547409.91');
    expect(minorToDecimal(-Number.MAX_SAFE_INTEGER, 'KWD')).toBe('-9007199254740.991');
    expect(minorToDecimal(Number.MAX_SAFE_INTEGER, 'JPY')).toBe('9007199254740991');
  });

  it('round-trips to the same integer with exactly the exponent’s fraction digits (property)', () => {
    const currencies = ['USD', 'JPY', 'KWD', 'CLF', 'EUR', 'BHD', 'VND'];
    fc.assert(
      fc.property(
        fc.oneof(fc.integer({ min: -LIMITS.amountMax, max: LIMITS.amountMax }), fc.maxSafeInteger(), fc.integer({ min: -1000, max: 1000 })),
        fc.constantFrom(...currencies),
        (amount, currency) => {
          const out = minorToDecimal(amount, currency);
          const exp = exponentOf(currency);
          expect(out).toMatch(exp === 0 ? /^-?(0|[1-9][0-9]*)$/ : new RegExp(`^-?(0|[1-9][0-9]*)\\.[0-9]{${exp}}$`));
          expect(BigInt(out.replace('.', ''))).toBe(BigInt(amount));
          if (amount === 0) expect(out.startsWith('-')).toBe(false);
        },
      ),
      { numRuns: 500 },
    );
  });

  it('throws RangeError on a non-safe-integer amount or unknown currency', () => {
    expect(() => minorToDecimal(1.5, 'USD')).toThrow(RangeError);
    expect(() => minorToDecimal(Number.NaN, 'USD')).toThrow(RangeError);
    expect(() => minorToDecimal(2 ** 53, 'USD')).toThrow(RangeError);
    expect(() => minorToDecimal(100, 'usd')).toThrow(RangeError);
    expect(() => minorToDecimal(1, 'XXX')).toThrow(RangeError);
  });
});

// ---------- Splits ----------

const idArb = fc.string({ minLength: 1, maxLength: 22 });
const membersArb = fc.uniqueArray(idArb, { minLength: 1, maxLength: 50 });
const amountArb = fc.oneof(
  fc.integer({ min: 0, max: LIMITS.amountMax }),
  fc.integer({ min: 0, max: 1000 }),
  fc.constant(LIMITS.amountMax),
);

const sum = (split: Record<string, number>): bigint => Object.values(split).reduce((a, v) => a + BigInt(v), 0n);

describe('splitEqual', () => {
  it('sums to the amount, is non-negative, and differs by at most one unit (property)', () => {
    fc.assert(
      fc.property(amountArb, membersArb, fc.string(), (amount, ids, seed) => {
        const split = splitEqual(amount, ids, seed);
        expect(Object.keys(split).sort()).toEqual([...ids].sort());
        expect(sum(split)).toBe(BigInt(amount));
        const values = Object.values(split);
        for (const v of values) {
          expect(Number.isSafeInteger(v)).toBe(true);
          expect(v).toBeGreaterThanOrEqual(0);
        }
        expect(Math.max(...values) - Math.min(...values)).toBeLessThanOrEqual(1);
        expect(isValidSplit(amount, split)).toBe(true);
      }),
      { numRuns: 1000 },
    );
  });

  it('gives the remainder to consecutive sorted members starting at hash(seed) % n (property)', () => {
    fc.assert(
      fc.property(amountArb, membersArb, fc.string(), (amount, ids, seed) => {
        const split = splitEqual(amount, ids, seed);
        const sorted = [...ids].sort();
        const n = sorted.length;
        const base = Number(BigInt(amount) / BigInt(n));
        const r = amount - base * n; // < n ≤ 50, and base * n ≤ amount ≤ 10^12, both exact
        const start = fnvRef(seed) % n;
        const expected = new Set(Array.from({ length: r }, (_, i) => sorted[(start + i) % n]));
        for (const id of sorted) expect(split[id]).toBe(base + (expected.has(id) ? 1 : 0));
      }),
      { numRuns: 500 },
    );
  });

  it('lets the seed change who gets the remainder', () => {
    const ids = ['carol', 'alice', 'bob'];
    const recipients = new Set<string>();
    for (let i = 0; i < 100; i++) {
      const split = splitEqual(1, ids, `expense-${i}`);
      const who = Object.entries(split).find(([, v]) => v === 1)?.[0];
      expect(who).toBeDefined();
      recipients.add(who ?? '');
    }
    expect([...recipients].sort()).toEqual(['alice', 'bob', 'carol']);
  });

  it('is deterministic and independent of member order', () => {
    const a = splitEqual(1000, ['m3', 'm1', 'm2'], 'seed');
    const b = splitEqual(1000, ['m1', 'm2', 'm3'], 'seed');
    expect(a).toEqual(b);
    expect(splitEqual(1000, ['m3', 'm1', 'm2'], 'seed')).toEqual(a);
    expect(Object.keys(a)).toEqual(['m1', 'm2', 'm3']);
    expect(sum(a)).toBe(1000n);
  });

  it('handles amountMax and 0', () => {
    const big = splitEqual(LIMITS.amountMax, ['a', 'b', 'c'], 'x');
    expect(sum(big)).toBe(BigInt(LIMITS.amountMax));
    expect(splitEqual(0, ['a', 'b'], 'x')).toEqual({ a: 0, b: 0 });
    expect(splitEqual(7, ['solo'], 'x')).toEqual({ solo: 7 });
  });

  it('treats "__proto__" as an ordinary id', () => {
    const split = splitEqual(3, ['__proto__', 'b', 'c'], 's');
    expect(Object.prototype.hasOwnProperty.call(split, '__proto__')).toBe(true);
    expect(Object.getPrototypeOf(split)).toBe(Object.prototype);
    expect(sum(split)).toBe(3n);
  });

  it('throws on empty or duplicate member ids and on a bad amount', () => {
    expect(() => splitEqual(100, [], 's')).toThrow(RangeError);
    expect(() => splitEqual(100, ['a', 'b', 'a'], 's')).toThrow(RangeError);
    expect(() => splitEqual(-1, ['a'], 's')).toThrow(RangeError);
    expect(() => splitEqual(1.5, ['a'], 's')).toThrow(RangeError);
    expect(() => splitEqual(2 ** 53, ['a'], 's')).toThrow(RangeError);
  });
});

/** Random bps over the given ids summing to 10000, from n−1 sorted cut points in [0, 10000]. */
const bpsArb = membersArb.chain((ids) =>
  fc
    .array(fc.integer({ min: 0, max: 10_000 }), { minLength: ids.length - 1, maxLength: ids.length - 1 })
    .map((cuts) => {
      const points = [0, ...cuts.sort((a, b) => a - b), 10_000];
      return Object.fromEntries(ids.map((id, i) => [id, (points[i + 1] ?? 0) - (points[i] ?? 0)]));
    }),
);

describe('splitByBasisPoints', () => {
  it('sums to the amount and gives each member floor(amount × bp / 10000) or one more (property)', () => {
    fc.assert(
      fc.property(amountArb, bpsArb, fc.string(), (amount, bps, seed) => {
        expect(Object.values(bps).reduce((a, b) => a + b, 0)).toBe(10_000);
        const split = splitByBasisPoints(amount, bps, seed);
        expect(Object.keys(split).sort()).toEqual(Object.keys(bps).sort());
        expect(sum(split)).toBe(BigInt(amount));
        for (const [id, bp] of Object.entries(bps)) {
          const floor = (BigInt(amount) * BigInt(bp)) / 10_000n;
          const got = BigInt(split[id] ?? -1);
          expect(got >= floor && got <= floor + 1n).toBe(true);
          if (bp === 0) expect(got).toBe(0n); // a member at 0% never owes a unit
        }
        expect(isValidSplit(amount, split)).toBe(true);
      }),
      { numRuns: 1000 },
    );
  });

  it('is exact where Number arithmetic is not: 999_999_990_111 × 9009', () => {
    const amount = 999_999_990_111;
    // The double product exceeds 2^53 and rounds up across the floor boundary.
    expect(Math.floor((amount * 9009) / 10_000)).toBe(900_899_991_091);
    const split = splitByBasisPoints(amount, { a: 9009, b: 991 }, 'seed');
    expect([900_899_991_090, 900_899_991_091]).toContain(split.a);
    expect([99_099_999_020, 99_099_999_021]).toContain(split.b);
    expect(sum(split)).toBe(BigInt(amount));
    // Floors are 900_899_991_090 + 99_099_999_020 = amount − 1: exactly one extra unit, placed by the seed.
    expect(split.a! + split.b!).toBe(amount);
    const start = fnvRef('seed') % 2;
    expect(start === 0 ? split.a : split.b).toBe(start === 0 ? 900_899_991_091 : 99_099_999_021);
  });

  it('handles amountMax', () => {
    const split = splitByBasisPoints(LIMITS.amountMax, { a: 3333, b: 3333, c: 3334 }, 'x');
    expect(sum(split)).toBe(BigInt(LIMITS.amountMax));
    expect(split.c).toBe(333_400_000_000);
    const lopsided = splitByBasisPoints(LIMITS.amountMax, { a: 9999, b: 1 }, 'x');
    expect(lopsided).toEqual({ a: 999_900_000_000, b: 100_000_000 });
  });

  // Changed in the integration review: the remainder used to be spread over ALL keys, so a 0-bp member could owe a
  // unit. It now goes only to members with bp > 0 (design.md "Rounding").
  it('never gives a remainder unit to a 0-bp member', () => {
    const recipients = new Set<string>();
    for (let i = 0; i < 50; i++) {
      // 1 unit, floors are all 0; before the fix the unit landed on 'zero' for some seeds.
      const split = splitByBasisPoints(1, { a: 5000, b: 5000, zero: 0 }, `s${i}`);
      expect(split.zero).toBe(0);
      expect(split.a! + split.b!).toBe(1);
      recipients.add(Object.entries(split).find(([, v]) => v === 1)?.[0] ?? '');
    }
    expect([...recipients].sort()).toEqual(['a', 'b']); // the seed still rotates it among the positive members
  });

  it('places the remainder among positive-bp members at hash(seed) % k in ascending-id order', () => {
    // bps 0/3333/0/3333/3334 over ids a..e: positive ids [b, d, e]; 10 units → floors 3,3,3 → remainder 1.
    for (const seed of ['x', 'y', 'z', 'seed-4']) {
      const split = splitByBasisPoints(10, { a: 0, b: 3333, c: 0, d: 3333, e: 3334 }, seed);
      const positive = ['b', 'd', 'e'];
      const lucky = positive[fnvRef(seed) % positive.length] ?? '';
      expect(split).toEqual({ a: 0, b: lucky === 'b' ? 4 : 3, c: 0, d: lucky === 'd' ? 4 : 3, e: lucky === 'e' ? 4 : 3 });
    }
  });

  it('is deterministic and matches splitEqual for equal bps', () => {
    const bps = { x: 2500, y: 2500, z: 2500, w: 2500 };
    expect(splitByBasisPoints(1003, bps, 'e1')).toEqual(splitByBasisPoints(1003, { ...bps }, 'e1'));
    expect(splitByBasisPoints(1003, bps, 'e1')).toEqual(splitEqual(1003, ['x', 'y', 'z', 'w'], 'e1'));
  });

  it('throws on empty, negative, fractional or mis-summed bps', () => {
    expect(() => splitByBasisPoints(100, {}, 's')).toThrow(RangeError);
    expect(() => splitByBasisPoints(100, { a: 10_001, b: -1 }, 's')).toThrow(RangeError);
    expect(() => splitByBasisPoints(100, { a: 5000.5, b: 4999.5 }, 's')).toThrow(RangeError);
    expect(() => splitByBasisPoints(100, { a: 5000, b: 4999 }, 's')).toThrow(RangeError);
    expect(() => splitByBasisPoints(100, { a: 5000, b: 5001 }, 's')).toThrow(RangeError);
    expect(() => splitByBasisPoints(100, { a: Number.NaN, b: 10_000 }, 's')).toThrow(RangeError);
    expect(() => splitByBasisPoints(-1, { a: 10_000 }, 's')).toThrow(RangeError);
  });
});

/**
 * An amount, then 1..50 members with weights in [0, 100] (one forced ≥ 1) and extras summing to at most the amount,
 * cut from a random total (0, anything up to the amount, or exactly the amount); some zero extras are left unset.
 */
const weightedArb = fc.tuple(amountArb, membersArb).chain(([amount, ids]) => {
  const n = ids.length;
  return fc
    .record({
      weights: fc.array(fc.integer({ min: 0, max: 100 }), { minLength: n, maxLength: n }),
      forced: fc.integer({ min: 0, max: n - 1 }),
      extraTotal: fc.oneof(fc.constant(0), fc.integer({ min: 0, max: amount }), fc.constant(amount)),
      cuts: fc.array(fc.integer({ min: 0, max: 1_000_000 }), { minLength: n - 1, maxLength: n - 1 }),
      unset: fc.array(fc.boolean(), { minLength: n, maxLength: n }),
    })
    .map(({ weights, forced, extraTotal, cuts, unset }) => {
      const points = [0, ...cuts.map((c) => Number((BigInt(extraTotal) * BigInt(c)) / 1_000_000n)).sort((a, b) => a - b), extraTotal];
      const members: Record<string, WeightedShare> = Object.fromEntries(
        ids.map((id, i): [string, WeightedShare] => {
          const weight = i === forced ? Math.max(1, weights[i] ?? 1) : (weights[i] ?? 0);
          const extra = (points[i + 1] ?? 0) - (points[i] ?? 0);
          return [id, extra === 0 && unset[i] === true ? { weight } : { weight, extra }];
        }),
      );
      return { amount, members };
    });
});

/** Independent reference for splitWeighted, using fnvRef for the start index. */
function weightedRef(amount: number, members: Record<string, WeightedShare>, seed: string): Record<string, number> {
  const ids = Object.keys(members).sort();
  const w = (id: string): bigint => BigInt(members[id]?.weight ?? 0);
  const x = (id: string): bigint => BigInt(members[id]?.extra ?? 0);
  const rest = BigInt(amount) - ids.reduce((a, id) => a + x(id), 0n);
  const total = ids.reduce((a, id) => a + w(id), 0n);
  const floors = new Map(ids.map((id) => [id, total === 0n ? 0n : (rest * w(id)) / total]));
  let leftover = Number(rest - [...floors.values()].reduce((a, b) => a + b, 0n));
  const positive = ids.filter((id) => w(id) > 0n);
  const lucky = new Set<string>();
  for (let i = fnvRef(seed) % Math.max(positive.length, 1); leftover > 0; i++, leftover--) lucky.add(positive[i % positive.length] ?? '');
  return Object.fromEntries(ids.map((id) => [id, Number((floors.get(id) ?? 0n) + x(id) + (lucky.has(id) ? 1n : 0n))]));
}

const ones = (ids: readonly string[]): Record<string, WeightedShare> => Object.fromEntries(ids.map((id) => [id, { weight: 1 }]));

describe('splitWeighted', () => {
  it('takes extras off the top and splits the rest by weight: 100.00 among A, B, C with C +40.00', () => {
    for (const seed of ['x', 'y', 'e1', 'expense-7']) {
      const split = splitWeighted(10_000, { A: { weight: 1 }, B: { weight: 1 }, C: { weight: 1, extra: 4000 } }, seed);
      expect(split).toEqual({ A: 2000, B: 2000, C: 6000 });
    }
  });

  it('splits 100.00 as 2 shares to 1, the odd unit placed by the seed', () => {
    const outcomes = new Set<string>();
    for (let i = 0; i < 20; i++) {
      const seed = `expense-${i}`;
      const split = splitWeighted(10_000, { A: { weight: 2 }, B: { weight: 1 } }, seed);
      const a = split.A ?? -1;
      const b = split.B ?? -1;
      expect(a + b).toBe(10_000);
      // Each member is within one unit of its exact share, so |A − 2B| ≤ 2 (6666/3334 gives −2, not ≥ 2B − 1).
      expect(a).toBeGreaterThanOrEqual(2 * b - 2);
      expect(a).toBeLessThanOrEqual(2 * b + 2);
      // Floors are 6666 + 3333: one leftover unit, to the weight > 0 member at hash(seed) % 2 of [A, B].
      expect(split).toEqual(fnvRef(seed) % 2 === 0 ? { A: 6667, B: 3333 } : { A: 6666, B: 3334 });
      outcomes.add(`${a}/${b}`);
    }
    expect([...outcomes].sort()).toEqual(['6666/3334', '6667/3333']);
  });

  it('gives a weight-0 member exactly its extra and never a leftover unit', () => {
    const recipients = new Set<string>();
    for (let i = 0; i < 50; i++) {
      // 1001 − 100 = 901 over weights 1:1 → floors 450, 450, one leftover unit.
      const split = splitWeighted(1001, { a: { weight: 1 }, b: { weight: 1 }, tip: { weight: 0, extra: 100 }, none: { weight: 0 } }, `s${i}`);
      expect(split.tip).toBe(100);
      expect(split.none).toBe(0);
      expect(split.a! + split.b!).toBe(901);
      recipients.add(Object.entries(split).find(([, v]) => v === 451)?.[0] ?? '');
    }
    expect([...recipients].sort()).toEqual(['a', 'b']);
  });

  it('accepts all weights 0 when the extras sum to the amount exactly', () => {
    expect(splitWeighted(1000, { a: { weight: 0, extra: 300 }, b: { weight: 0, extra: 700 }, c: { weight: 0 } }, 's')).toEqual({ a: 300, b: 700, c: 0 });
    expect(splitWeighted(0, { a: { weight: 0 }, b: { weight: 0, extra: 0 } }, 's')).toEqual({ a: 0, b: 0 });
    // Extras covering the amount with positive weights leaves nothing to split by weight.
    expect(splitWeighted(500, { a: { weight: 3, extra: 500 }, b: { weight: 1 } }, 's')).toEqual({ a: 500, b: 0 });
  });

  it('is exact where Number arithmetic is not', () => {
    // Same numbers as splitByBasisPoints' case: 999_999_990_111 × 9009 exceeds 2^53 and rounds across the floor.
    const amount = 999_999_990_111;
    const bySeed = splitWeighted(amount, { a: { weight: 9009 }, b: { weight: 991 } }, 'seed');
    expect(bySeed).toEqual(splitByBasisPoints(amount, { a: 9009, b: 991 }, 'seed'));
    expect([900_899_991_090, 900_899_991_091]).toContain(bySeed.a);
    // Weights may be any safe integer: R × w reaches ~9 × 10^27 here.
    for (const seed of ['x', 'y', 'z']) {
      const huge = splitWeighted(LIMITS.amountMax, { a: { weight: Number.MAX_SAFE_INTEGER }, b: { weight: 1 } }, seed);
      expect(huge).toEqual(fnvRef(seed) % 2 === 0 ? { a: LIMITS.amountMax, b: 0 } : { a: LIMITS.amountMax - 1, b: 1 });
    }
  });

  it('handles amountMax among 50 members with weights up to 100 (BigInt guard)', () => {
    const members = Object.fromEntries(
      Array.from({ length: 50 }, (_, i): [string, WeightedShare] => [`m${String(i).padStart(2, '0')}`, i % 5 === 0 ? { weight: 100 - i, extra: 1_000_000_007 } : { weight: 100 - i }]),
    );
    const split = splitWeighted(LIMITS.amountMax, members, 'big');
    expect(sum(split)).toBe(BigInt(LIMITS.amountMax));
    expect(split).toEqual(weightedRef(LIMITS.amountMax, members, 'big'));
    for (const v of Object.values(split)) expect(Number.isSafeInteger(v)).toBe(true);
    expect(isValidSplit(LIMITS.amountMax, split)).toBe(true);
  });

  it('sums to the amount, keys every member, and never gives less than the extra (property)', () => {
    fc.assert(
      fc.property(weightedArb, fc.string(), ({ amount, members }, seed) => {
        const split = splitWeighted(amount, members, seed);
        expect(Object.keys(split).sort()).toEqual(Object.keys(members).sort());
        expect(sum(split)).toBe(BigInt(amount));
        for (const [id, { extra = 0 }] of Object.entries(members)) {
          const v = split[id] ?? -1;
          expect(Number.isSafeInteger(v)).toBe(true);
          expect(v).toBeGreaterThanOrEqual(extra);
        }
        expect(isValidSplit(amount, split)).toBe(true);
      }),
      { numRuns: 1000 },
    );
  });

  it('gives floor(R × w / W) + extra, leftover to consecutive weight > 0 members from hash(seed) % k (property)', () => {
    fc.assert(
      fc.property(weightedArb, fc.string(), ({ amount, members }, seed) => {
        expect(splitWeighted(amount, members, seed)).toEqual(weightedRef(amount, members, seed));
      }),
      { numRuns: 500 },
    );
  });

  it('is deterministic and independent of member order (property)', () => {
    fc.assert(
      fc.property(weightedArb, fc.string(), ({ amount, members }, seed) => {
        const a = splitWeighted(amount, members, seed);
        expect(splitWeighted(amount, members, seed)).toEqual(a);
        expect(splitWeighted(amount, Object.fromEntries(Object.entries(members).reverse()), seed)).toEqual(a);
      }),
      { numRuns: 300 },
    );
  });

  it('equals splitEqual, key order included, when every weight is 1 and there are no extras (property)', () => {
    fc.assert(
      fc.property(amountArb, membersArb, fc.string(), (amount, ids, seed) => {
        const equal = Object.entries(splitEqual(amount, ids, seed));
        expect(Object.entries(splitWeighted(amount, ones(ids), seed))).toEqual(equal);
        const zeroExtras = Object.fromEntries(ids.map((id) => [id, { weight: 1, extra: 0 }]));
        expect(Object.entries(splitWeighted(amount, zeroExtras, seed))).toEqual(equal);
      }),
      { numRuns: 1000 },
    );
  });

  it('only moves leftover units when the seed changes (property)', () => {
    fc.assert(
      fc.property(weightedArb, fc.string(), fc.string(), ({ amount, members }, s1, s2) => {
        const a = splitWeighted(amount, members, s1);
        const b = splitWeighted(amount, members, s2);
        for (const [id, { weight }] of Object.entries(members)) {
          const d = Math.abs((a[id] ?? 0) - (b[id] ?? 0));
          expect(d).toBeLessThanOrEqual(1);
          if (weight === 0) expect(d).toBe(0);
        }
      }),
      { numRuns: 500 },
    );
  });

  it('treats "__proto__" as an ordinary id', () => {
    const members = Object.fromEntries([['__proto__', { weight: 2, extra: 1 }], ['b', { weight: 1 }]]) as Record<string, WeightedShare>;
    const split = splitWeighted(7, members, 's');
    expect(Object.prototype.hasOwnProperty.call(split, '__proto__')).toBe(true);
    expect(Object.getPrototypeOf(split)).toBe(Object.prototype);
    expect(sum(split)).toBe(7n);
  });

  it('throws RangeError on bad members, weights, extras or amount', () => {
    const bad = (amount: number, members: unknown): (() => unknown) => () => splitWeighted(amount, members as Record<string, WeightedShare>, 's');
    expect(bad(100, {})).toThrow(/non-empty/);
    expect(bad(100, { a: { weight: -1 }, b: { weight: 2 } })).toThrow(RangeError);
    expect(bad(100, { a: { weight: 1.5 } })).toThrow(RangeError);
    expect(bad(100, { a: { weight: Number.NaN } })).toThrow(RangeError);
    expect(bad(100, { a: { weight: 2 ** 53 } })).toThrow(RangeError);
    expect(bad(100, { a: { weight: '1' } })).toThrow(RangeError);
    expect(bad(100, { a: {} })).toThrow(RangeError);
    expect(bad(100, { a: 1 })).toThrow(RangeError);
    expect(bad(100, { a: null })).toThrow(RangeError);
    expect(bad(100, { a: { weight: 1, extra: -1 } })).toThrow(RangeError);
    expect(bad(100, { a: { weight: 1, extra: 0.5 } })).toThrow(RangeError);
    expect(bad(100, { a: { weight: 1, extra: null } })).toThrow(RangeError);
    expect(bad(100, { a: { weight: 1, extra: 60 }, b: { weight: 1, extra: 41 } })).toThrow(/more than the amount/);
    expect(bad(100, { a: { weight: 0, extra: 60 }, b: { weight: 0, extra: 39 } })).toThrow(/every weight is 0/);
    expect(bad(100, { a: { weight: 0 } })).toThrow(/every weight is 0/);
    expect(bad(-1, { a: { weight: 1 } })).toThrow(RangeError);
    expect(bad(1.5, { a: { weight: 1 } })).toThrow(RangeError);
    expect(bad(100, null)).toThrow(TypeError);
  });
});

describe('splitSum', () => {
  it('sums in BigInt and returns a Number', () => {
    expect(splitSum({})).toBe(0);
    expect(splitSum({ a: 1, b: 2, c: 3 })).toBe(6);
    expect(splitSum({ a: Number.MAX_SAFE_INTEGER - 1, b: 1 })).toBe(Number.MAX_SAFE_INTEGER);
  });

  it('throws when a value or the total is not a safe integer', () => {
    expect(() => splitSum({ a: Number.MAX_SAFE_INTEGER, b: 1 })).toThrow(RangeError);
    expect(() => splitSum({ a: 1.5 })).toThrow(RangeError);
    expect(() => splitSum({ a: Number.NaN })).toThrow(RangeError);
  });
});

describe('isValidSplit', () => {
  it('accepts a non-empty split of non-negative safe integers summing to the amount', () => {
    expect(isValidSplit(100, { a: 50, b: 50 })).toBe(true);
    expect(isValidSplit(100, { a: 100, b: 0 })).toBe(true);
    expect(isValidSplit(0, { a: 0 })).toBe(true);
    expect(isValidSplit(LIMITS.amountMax, { a: LIMITS.amountMax })).toBe(true);
  });

  it('rejects everything else without throwing', () => {
    expect(isValidSplit(100, {})).toBe(false);
    expect(isValidSplit(100, { a: 50, b: 49 })).toBe(false);
    expect(isValidSplit(100, { a: 101, b: -1 })).toBe(false);
    expect(isValidSplit(100, { a: 50.5, b: 49.5 })).toBe(false);
    expect(isValidSplit(100, { a: Number.NaN })).toBe(false);
    expect(isValidSplit(100, { a: '100' } as unknown as Record<string, number>)).toBe(false);
    expect(isValidSplit(-1, { a: -1 })).toBe(false);
    expect(isValidSplit(1.5, { a: 1.5 })).toBe(false);
    expect(isValidSplit(2 ** 53, { a: 2 ** 53 })).toBe(false);
    expect(isValidSplit(100, null as unknown as Record<string, number>)).toBe(false);
    expect(isValidSplit(100, [100] as unknown as Record<string, number>)).toBe(false);
    // Sum computed in BigInt: two safe values whose Number sum rounds to the amount must not pass.
    expect(isValidSplit(2 ** 53 - 1, { a: 2 ** 53 - 1, b: 1 })).toBe(false);
  });

  it('returns false for a hostile object instead of throwing', () => {
    const getter = { get a(): number { throw new Error('boom'); } };
    const proxy = new Proxy({}, { ownKeys: () => { throw new Error('boom'); } });
    expect(isValidSplit(1, getter as unknown as Record<string, number>)).toBe(false);
    expect(isValidSplit(1, proxy as Record<string, number>)).toBe(false);
  });
});
