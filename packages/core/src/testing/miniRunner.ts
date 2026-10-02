/**
 * A minimal `describe` / `it` / `expect` (the `SuiteApi` slice of Vitest) for running a portable suite where Vitest
 * cannot: in Hermes on a phone, through the development crypto harness. Same order as Vitest: `describe` bodies run
 * while collecting, `it` bodies afterwards, in order. Only synchronous tests. Its own correctness is tested in Node
 * (`miniRunner.test.ts`), including that a broken AEAD makes the envelope suite fail through it.
 */
import type { SuiteApi, SuiteAssertion, SuiteMatchers } from './suiteApi.js';

export interface MiniRunResult {
  passed: number;
  failed: number;
  /** "describe › it: message", the first few. */
  failures: string[];
  ms: number;
}

class AssertionFailed extends Error {}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (typeof value !== 'object' || value === null) return false;
  const proto = Object.getPrototypeOf(value) as unknown;
  return proto === Object.prototype || proto === null;
}

function deepEqual(a: unknown, b: unknown): boolean {
  if (Object.is(a, b)) return true;
  if (a instanceof Uint8Array || b instanceof Uint8Array) {
    if (!(a instanceof Uint8Array) || !(b instanceof Uint8Array) || a.length !== b.length) return false;
    for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
    return true;
  }
  if (Array.isArray(a) || Array.isArray(b)) {
    if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) return false;
    return a.every((item, i) => deepEqual(item, b[i]));
  }
  if (isPlainObject(a) && isPlainObject(b)) {
    const ka = Object.keys(a).filter((k) => a[k] !== undefined).sort();
    const kb = Object.keys(b).filter((k) => b[k] !== undefined).sort();
    return deepEqual(ka, kb) && ka.every((k) => deepEqual(a[k], b[k]));
  }
  return false;
}

function matchesObject(actual: unknown, expected: unknown): boolean {
  if (isPlainObject(expected)) {
    if (typeof actual !== 'object' || actual === null) return false;
    const record = actual as Record<string, unknown>;
    return Object.keys(expected).every((k) => matchesObject(record[k], expected[k]));
  }
  return deepEqual(actual, expected);
}

function show(value: unknown): string {
  try {
    if (value instanceof Uint8Array) return `Uint8Array(${value.length})`;
    const text = JSON.stringify(value);
    return text === undefined ? String(value) : text.length > 80 ? `${text.slice(0, 77)}...` : text;
  } catch {
    return String(value);
  }
}

function matchers(actual: unknown, negate: boolean): SuiteMatchers {
  const check = (ok: boolean, message: string): void => {
    if (ok === negate) throw new AssertionFailed(negate ? `not ${message}` : message);
  };
  return {
    toBe: (expected) => check(Object.is(actual, expected), `expected ${show(actual)} to be ${show(expected)}`),
    toEqual: (expected) => check(deepEqual(actual, expected), `expected ${show(actual)} to equal ${show(expected)}`),
    toBeInstanceOf: (expected) =>
      check(typeof expected === 'function' && actual instanceof expected, `expected an instance of ${String(expected?.name)}`),
    toMatch: (expected) => check(typeof actual === 'string' && expected.test(actual), `expected ${show(actual)} to match ${expected}`),
    toHaveLength: (expected) =>
      check((actual as { length?: unknown } | null)?.length === expected, `expected length ${expected}, got ${show((actual as { length?: unknown } | null)?.length)}`),
    toBeGreaterThan: (expected) => check(typeof actual === 'number' && actual > expected, `expected ${show(actual)} > ${expected}`),
    toBeLessThan: (expected) => check(typeof actual === 'number' && actual < expected, `expected ${show(actual)} < ${expected}`),
    toBeLessThanOrEqual: (expected) => check(typeof actual === 'number' && actual <= expected, `expected ${show(actual)} <= ${expected}`),
    toThrow: (expected) => {
      if (typeof actual !== 'function') throw new AssertionFailed('toThrow needs a function');
      let threw = false;
      let error: unknown;
      try {
        (actual as () => unknown)();
      } catch (e) {
        threw = true;
        error = e;
      }
      const kindOk = expected === undefined || (typeof expected === 'function' && error instanceof expected);
      check(threw && kindOk, `expected a throw${expected === undefined ? '' : ` of ${String(expected?.name)}`}`);
    },
    toMatchObject: (expected) => check(matchesObject(actual, expected), `expected ${show(actual)} to match ${show(expected)}`),
  };
}

export function createMiniRunner(): { api: SuiteApi; run: () => MiniRunResult } {
  const tests: { name: string; body: () => void }[] = [];
  const path: string[] = [];
  const api: SuiteApi = {
    describe(name, body) {
      path.push(name);
      try {
        body();
      } finally {
        path.pop();
      }
    },
    it(name, body) {
      tests.push({ name: [...path, name].join(' › '), body });
    },
    expect(actual): SuiteAssertion {
      return { ...matchers(actual, false), not: matchers(actual, true) };
    },
  };
  const run = (): MiniRunResult => {
    const started = Date.now();
    const result: MiniRunResult = { passed: 0, failed: 0, failures: [], ms: 0 };
    for (const test of tests) {
      try {
        test.body();
        result.passed += 1;
      } catch (error) {
        result.failed += 1;
        if (result.failures.length < 20) {
          result.failures.push(`${test.name}: ${error instanceof Error ? error.message : String(error)}`);
        }
      }
    }
    result.ms = Date.now() - started;
    return result;
  };
  return { api, run };
}
