import { describe, expect, it } from 'vitest';

import { isCaughtComponentError } from './caughtRenderErrors';

describe('isCaughtComponentError', () => {
  it('is a component error React Native reports as not fatal: one an error boundary caught', () => {
    const error = Object.assign(new Error('a message that may quote a local id'), {
      isComponentError: true,
    });
    expect(isCaughtComponentError(error, false)).toBe(true);
  });

  it('leaves uncaught errors, and everything that is not a component error, to React Native', () => {
    const component = Object.assign(new Error('x'), { isComponentError: true });
    expect(isCaughtComponentError(component, true)).toBe(false);
    expect(isCaughtComponentError(new Error('x'), false)).toBe(false);
    expect(
      isCaughtComponentError(Object.assign(new Error('x'), { isComponentError: 'yes' }), false),
    ).toBe(false);
    expect(isCaughtComponentError('a string', false)).toBe(false);
    expect(isCaughtComponentError(null, false)).toBe(false);
  });
});
