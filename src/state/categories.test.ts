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

  it('keystrokes re-infer until the user taps', () => {
    let chip = initialChip('');
    expect(chip).toEqual({ category: 'other', source: 'keyword' });
    chip = chipAfterTitle(chip, 'Dinner');
    expect(chip).toEqual({ category: 'food', source: 'keyword' });
    chip = chipAfterTap(chip, 'drinks');
    expect(chip).toEqual({ category: 'drinks', source: 'user' });
    expect(chipAfterTitle(chip, 'Uber')).toBe(chip);
  });

  it('a model reply applies only for the exact title asked about, and never over a tap', () => {
    const chip = chipAfterTitle(initialChip(''), 'Fairmont Banff');
    expect(shouldRefine(chip, 'Fairmont Banff')).toBe(true);
    expect(shouldRefine(chip, '   ')).toBe(false);
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
  });

  it('a later model reply refines an earlier one', () => {
    const first = chipAfterReply(chipAfterTitle(initialChip(''), 'Sunshine'), 'Sunshine', {
      askedTitle: 'Sunshine',
      category: 'lodging',
    });
    expect(first).toEqual({ category: 'lodging', source: 'model' });
    expect(shouldRefine(first, 'Sunshine')).toBe(true);
    const refined = chipAfterReply(first, 'Sunshine', {
      askedTitle: 'Sunshine',
      category: 'activities',
    });
    expect(refined).toEqual({ category: 'activities', source: 'model' });
    // The same answer again changes nothing.
    expect(
      chipAfterReply(refined, 'Sunshine', { askedTitle: 'Sunshine', category: 'activities' }),
    ).toBe(refined);
    // A stale model reply is still dropped.
    expect(
      chipAfterReply(refined, 'Sunshine lift', { askedTitle: 'Sunshine', category: 'lodging' }),
    ).toBe(refined);
  });

  it('a keystroke after a model answer re-infers from the table, as a keyword chip', () => {
    const model = chipAfterReply(initialChip('Nourish'), 'Nourish', {
      askedTitle: 'Nourish',
      category: 'food',
    });
    expect(model).toEqual({ category: 'food', source: 'model' });
    expect(chipAfterTitle(model, 'Nourish parking')).toEqual({
      category: 'parking',
      source: 'keyword',
    });
    // Even when the table agrees with the model, the chip is a keyword guess again.
    expect(chipAfterTitle(model, 'Nourish dinner')).toEqual({
      category: 'food',
      source: 'keyword',
    });
    expect(shouldRefine(model, 'Nourish')).toBe(true);
  });

  it('an edited expense starts from its saved category as a user choice', () => {
    expect(initialChip('Uber', 'food')).toEqual({ category: 'food', source: 'user' });
  });
});
