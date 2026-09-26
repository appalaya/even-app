import { describe, expect, it } from 'vitest';

import { isNameTaken, nameTakenMessage } from './names';

describe('names', () => {
  it('compares case-insensitively, ignoring surrounding whitespace', () => {
    expect(isNameTaken(' maya ', ['Maya', 'Jordan'])).toBe(true);
    expect(isNameTaken('Maya K', ['Maya'])).toBe(false);
    expect(isNameTaken('  ', ['Maya'])).toBe(false);
  });

  it('words the collision as the States board does', () => {
    expect(nameTakenMessage('Maya ')).toBe('Someone here is already called Maya.');
  });
});
