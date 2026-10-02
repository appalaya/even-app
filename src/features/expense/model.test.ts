import { describe, expect, it } from 'vitest';

import { editableCurrency } from './model';

describe('Expense detail: which expenses can be edited', () => {
  it('needs both the expense currency and the group currency in the ISO 4217 table', () => {
    expect(editableCurrency('CAD', 'CAD')).toBe(true);
    // A currency_mismatch expense in a known currency can still be edited (its banner says why it is left out).
    expect(editableCurrency('USD', 'CAD')).toBe(true);
    // A shape-valid code the table does not know: the edit sheet would have no exponent and throw.
    expect(editableCurrency('ZZZ', 'CAD')).toBe(false);
    expect(editableCurrency('CAD', 'ZZZ')).toBe(false);
    expect(editableCurrency('CAD', null)).toBe(false);
  });
});
