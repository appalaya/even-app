import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { CATEGORIES, type Category } from './types.js';
import { recallCategory, rememberCategories, type PastExpense } from './categoryHistory.js';

let clock = 0;
const saved = (title: string, category: Category, at = (clock += 1)): PastExpense => ({ title, category, at });
const group = (...expenses: PastExpense[]) => rememberCategories(expenses);

describe('recallCategory: the same title', () => {
  it('recalls the category saved with the same title, ignoring case, accents, punctuation and apostrophes', () => {
    const memory = group(saved("Tim Horton's", 'coffee'), saved('Café Mocha', 'coffee'), saved('Nourish', 'food'));
    expect(recallCategory('tim hortons', [memory])).toEqual({ category: 'coffee', match: 'same' });
    expect(recallCategory('TIM HORTONS!!', [memory])).toEqual({ category: 'coffee', match: 'same' });
    expect(recallCategory('cafe mocha', [memory])).toEqual({ category: 'coffee', match: 'same' });
    expect(recallCategory('  nourish ', [memory])).toEqual({ category: 'food', match: 'same' });
  });

  it('treats a possessive or plural "s" on a longer word as the same word', () => {
    const memory = group(saved("Chuck's", 'food'), saved('Lattes at Evelyns', 'coffee'));
    expect(recallCategory('Chuck', [memory])?.category).toBe('food');
    expect(recallCategory('Chucks', [memory])?.category).toBe('food');
    expect(recallCategory("Latte at Evelyn's", [memory])?.category).toBe('coffee');
  });

  it('lets the latest save win among equal titles, so a correction sticks', () => {
    const memory = group(saved('Banff parkade', 'activities', 1), saved('banff parkade', 'parking', 2));
    expect(recallCategory('Banff Parkade', [memory])?.category).toBe('parking');
    const reordered = group(saved('banff parkade', 'parking', 2), saved('Banff parkade', 'activities', 1));
    expect(recallCategory('Banff Parkade', [reordered])?.category).toBe('parking');
  });

  it('looks in the open group first, then the others', () => {
    const open = group(saved('Rundle', 'drinks'));
    const other = group(saved('Rundle', 'activities'), saved('Sunshine', 'activities'));
    expect(recallCategory('Rundle', [open, other])?.category).toBe('drinks');
    expect(recallCategory('Rundle', [other, open])?.category).toBe('activities');
    expect(recallCategory('Sunshine', [open, other])).toEqual({ category: 'activities', match: 'same' });
  });

  it('prefers the same title in any group over a similar one in the open group', () => {
    const open = group(saved('Nesters', 'groceries'));
    const other = group(saved('Nesters Deli', 'food'));
    expect(recallCategory('Nesters Deli', [open, other])).toEqual({ category: 'food', match: 'same' });
  });
});

describe('recallCategory: a similar title (trailing words)', () => {
  it('recalls a saved title that the typed one extends', () => {
    const memory = group(saved('Safeway', 'groceries'), saved('Shell', 'fuel'), saved('Impark', 'parking'));
    expect(recallCategory('Safeway run', [memory])).toEqual({ category: 'groceries', match: 'similar' });
    expect(recallCategory('Shell Canmore', [memory])?.category).toBe('fuel');
    expect(recallCategory('Impark lot 5', [memory])?.category).toBe('parking');
  });

  it('recalls a saved title that extends the typed one', () => {
    const memory = group(saved('Nourish Bistro', 'food'), saved("Wild Bill's Saloon", 'drinks'));
    expect(recallCategory('Nourish', [memory])).toEqual({ category: 'food', match: 'similar' });
    expect(recallCategory('Wild Bills', [memory])?.category).toBe('drinks');
  });

  it('prefers the longest saved title the typed one extends', () => {
    const memory = group(saved('Banff', 'lodging'), saved('Banff Ave Brewing', 'drinks'));
    expect(recallCategory('Banff Ave Brewing Co', [memory])?.category).toBe('drinks');
  });

  it('does not match when the extra words say something the keyword table can see', () => {
    const memory = group(
      saved('Costco gas', 'fuel'),
      saved('Uber Eats', 'food'),
      saved('Lake Louise', 'activities'),
      saved('Hotel bar', 'drinks'),
      saved('Coffee beans from Costco', 'groceries'),
    );
    expect(recallCategory('Costco', [memory])).toBeNull(); // "gas" is a keyword
    expect(recallCategory('Uber', [memory])).toBeNull(); // "Uber" is transit, "Uber Eats" food
    expect(recallCategory('Lake Louise parking', [memory])).toBeNull(); // "parking" is a keyword
    expect(recallCategory('Hotel', [memory])).toBeNull(); // "bar" is a keyword
    expect(recallCategory('Coffee', [memory])).toBeNull(); // "costco" is a keyword
  });

  it('has no answer when the saved titles that extend the typed one disagree', () => {
    const memory = group(saved('Rimrock Lounge', 'drinks'), saved('Rimrock Suites', 'lodging'));
    expect(recallCategory('Rimrock', [memory])).toBeNull();
    const agree = group(saved('Rimrock two nights', 'lodging'), saved('Rimrock deposit', 'lodging'));
    expect(recallCategory('Rimrock', [agree])?.category).toBe('lodging');
  });

  it('needs a real word in the shorter title, not a filler word or a partial one', () => {
    const memory = group(saved('The Keg', 'food'), saved('At the Rimrock', 'lodging'), saved('Sunshine', 'activities'));
    expect(recallCategory('The', [memory])).toBeNull();
    expect(recallCategory('At the', [memory])).toBeNull();
    expect(recallCategory('Suns', [memory])).toBeNull(); // a word still being typed
    expect(recallCategory('Sunshine Village', [memory])?.category).toBe('activities');
  });

  it('never matches words in the middle or at the end', () => {
    const memory = group(saved('Banff Ave Brewing Co', 'drinks'), saved('Canmore', 'lodging'));
    expect(recallCategory('Banff Centre', [memory])).toBeNull();
    expect(recallCategory('Shell Canmore', [memory])).toBeNull();
  });
});

describe('recallCategory: edges', () => {
  it('has no answer without history, for a title with no letters or digits, or for a new title', () => {
    expect(recallCategory('Safeway', [])).toBeNull();
    expect(recallCategory('Safeway', [group()])).toBeNull();
    const memory = group(saved('🍕', 'food'), saved('Safeway', 'groceries'));
    expect(recallCategory('🍕', [memory])).toBeNull();
    expect(recallCategory('', [memory])).toBeNull();
    expect(recallCategory('   ', [memory])).toBeNull();
    expect(recallCategory('Nourish', [memory])).toBeNull();
  });

  it('only ever answers with a saved category (property)', () => {
    const titles = ['Safeway', 'Safeway run', 'Shell', 'Uber', 'Uber Eats', 'Nourish Bistro', 'The Keg', 'Costco gas'];
    fc.assert(
      fc.property(
        fc.array(fc.record({ title: fc.constantFrom(...titles), category: fc.constantFrom(...CATEGORIES) })),
        fc.oneof(fc.constantFrom(...titles, 'Safeway run for the week', 'Nourish'), fc.string({ maxLength: 20 })),
        (expenses, title) => {
          const memory = rememberCategories(expenses.map((e, at) => ({ ...e, at })));
          const recalled = recallCategory(title, [memory]);
          if (recalled !== null) expect(expenses.map((e) => e.category)).toContain(recalled.category);
          expect(recallCategory(title, [memory])).toEqual(recalled);
        },
      ),
      { numRuns: 300 },
    );
  });
});

describe('recallCategory on the eval set (categories.eval.json)', () => {
  const { cases } = JSON.parse(readFileSync(new URL('./categories.eval.json', import.meta.url), 'utf8')) as {
    cases: { title: string; category: Category }[];
  };

  it('recalls every near-repeat in the set with its label, leaving each title out of its own history', () => {
    const recalled: [string, Category, Category][] = [];
    cases.forEach((c, i) => {
      const others = cases.filter((_, j) => j !== i).map((o, at) => ({ ...o, at }));
      const hit = recallCategory(c.title, [rememberCategories(others)]);
      if (hit !== null) recalled.push([c.title, hit.category, c.category]);
    });
    for (const [title, got, label] of recalled) expect([title, got]).toEqual([title, label]);
    expect(recalled.length).toBeGreaterThanOrEqual(10);
  });
});
