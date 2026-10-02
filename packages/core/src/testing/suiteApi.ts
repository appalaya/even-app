/**
 * The slice of Vitest's API a portable suite may use (`envelopeSuite`): Vitest's own `describe`, `it` and `expect`
 * satisfy it in Node, and `createMiniRunner` provides it where Vitest cannot run (Hermes, on a phone, in the
 * development crypto harness). A suite written against this type runs unchanged in both.
 */

// Matcher arguments are deliberately loose: Vitest's own matchers are generic, and these must accept them.
/* eslint-disable @typescript-eslint/no-explicit-any */
export interface SuiteMatchers {
  toBe(expected: any): void;
  toEqual(expected: any): void;
  toBeInstanceOf(expected: any): void;
  toMatch(expected: RegExp): void;
  toHaveLength(expected: number): void;
  toBeGreaterThan(expected: number): void;
  toBeLessThan(expected: number): void;
  toBeLessThanOrEqual(expected: number): void;
  toThrow(expected?: any): void;
  toMatchObject(expected: any): void;
}

export interface SuiteAssertion extends SuiteMatchers {
  not: SuiteMatchers;
}

export interface SuiteApi {
  describe(name: string, body: () => void): void;
  it(name: string, body: () => void): void;
  expect(actual: unknown): SuiteAssertion;
}
