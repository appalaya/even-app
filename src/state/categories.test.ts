import { CATEGORIES, inferCategory as coreInfer } from '@even/core';
import { describe, expect, it } from 'vitest';

import {
  chipAfterReply,
  chipAfterTap,
  chipAfterTitle,
  inferCategory,
  initialChip,
  refineCategory,
  shouldRefine,
} from './categories';

describe('categories', () => {
  it('inferCategory is core keyword inference, unchanged', () => {
    for (const title of ['Dinner at Nourish', 'Uber to hotel', 'Parkade', 'Sunshine lift', '']) {
      expect(inferCategory(title)).toBe(coreInfer(title));
    }
    expect(CATEGORIES).toContain(inferCategory('Gas'));
  });

  it('refineCategory is a stub that has no answer until the on-device model module lands', async () => {
    await expect(refineCategory('Fairmont')).resolves.toBeNull();
  });

  it('keystrokes re-infer only while the source is keyword', () => {
    let chip = initialChip('');
    expect(chip).toEqual({ category: 'other', source: 'keyword' });
    chip = chipAfterTitle(chip, 'Dinner');
    expect(chip).toEqual({ category: 'food', source: 'keyword' });
    chip = chipAfterTap(chip, 'drinks');
    expect(chip).toEqual({ category: 'drinks', source: 'user' });
    expect(chipAfterTitle(chip, 'Uber')).toBe(chip);
  });

  it('a model reply applies only for the exact title asked about, and only while the source is keyword', () => {
    const chip = chipAfterTitle(initialChip(''), 'Fairmont Banff');
    expect(shouldRefine(chip, 'Fairmont Banff')).toBe(true);
    const applied = chipAfterReply(chip, 'Fairmont Banff', {
      askedTitle: 'Fairmont Banff',
      category: 'lodging',
    });
    expect(applied).toEqual({ category: 'lodging', source: 'model' });
    // The field moved on: the stale reply is dropped.
    expect(
      chipAfterReply(chip, 'Fairmont Banff spa', {
        askedTitle: 'Fairmont Banff',
        category: 'lodging',
      }),
    ).toBe(chip);
    // The user tapped meanwhile: the reply is dropped.
    const tapped = chipAfterTap(chip, 'activities');
    expect(
      chipAfterReply(tapped, 'Fairmont Banff', {
        askedTitle: 'Fairmont Banff',
        category: 'lodging',
      }),
    ).toBe(tapped);
    expect(shouldRefine(tapped, 'Fairmont Banff')).toBe(false);
    // No answer: nothing changes.
    expect(
      chipAfterReply(chip, 'Fairmont Banff', { askedTitle: 'Fairmont Banff', category: null }),
    ).toBe(chip);
    // After a model answer, keystrokes no longer re-infer and later replies are dropped (source is not keyword).
    expect(chipAfterTitle(applied, 'Fairmont')).toBe(applied);
    expect(shouldRefine(applied, 'Fairmont')).toBe(false);
  });

  it('an edited expense starts from its saved category as a user choice', () => {
    expect(initialChip('Uber', 'food')).toEqual({ category: 'food', source: 'user' });
  });
});
