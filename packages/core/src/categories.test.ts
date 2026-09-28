import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { CATEGORIES, type Category } from './types.js';
import { CATEGORY_EMOJI, CATEGORY_KEYWORDS, CATEGORY_LABEL, inferCategory, isCategory } from './categories.js';
import { LIMITS } from './constants.js';

const codePoints = (s: string): string => [...s].map((c) => c.codePointAt(0)?.toString(16)).join(' ');

describe('CATEGORY_EMOJI / CATEGORY_LABEL', () => {
  it('covers every category with a non-empty emoji and label, and nothing else', () => {
    expect(Object.keys(CATEGORY_EMOJI).sort()).toEqual([...CATEGORIES].sort());
    expect(Object.keys(CATEGORY_LABEL).sort()).toEqual([...CATEGORIES].sort());
    for (const c of CATEGORIES) {
      expect(CATEGORY_EMOJI[c].length).toBeGreaterThan(0);
      expect(CATEGORY_LABEL[c].length).toBeGreaterThan(0);
    }
    expect(Object.isFrozen(CATEGORY_EMOJI)).toBe(true);
    expect(Object.isFrozen(CATEGORY_LABEL)).toBe(true);
  });

  it('uses exactly the design.md emoji, variation selectors included', () => {
    const expected: Record<Category, string> = {
      food: '1f37d fe0f', groceries: '1f6d2', drinks: '1f37b', coffee: '2615',
      lodging: '1f3e8', flights: '2708 fe0f', transit: '1f686', fuel: '26fd', parking: '1f17f fe0f', rental: '1f697',
      activities: '1f39f fe0f', shopping: '1f6cd fe0f', fees: '1fa99', health: '1f48a', gifts: '1f381', other: '1f9fe',
    };
    for (const c of CATEGORIES) expect(codePoints(CATEGORY_EMOJI[c])).toBe(expected[c]);
  });

  it('uses the English labels', () => {
    expect(CATEGORIES.map((c) => CATEGORY_LABEL[c])).toEqual([
      'Food', 'Groceries', 'Drinks', 'Coffee', 'Lodging', 'Flights', 'Transit', 'Fuel', 'Parking', 'Rental',
      'Activities', 'Shopping', 'Fees', 'Health', 'Gifts', 'Other',
    ]);
  });
});

describe('isCategory', () => {
  it('accepts the sixteen categories only', () => {
    for (const c of CATEGORIES) expect(isCategory(c)).toBe(true);
    for (const bad of ['Food', 'FOOD', 'foods', '', ' food', 'toString', '__proto__', null, undefined, 1, {}, ['food']]) {
      expect(isCategory(bad)).toBe(false);
    }
  });
});

describe('CATEGORY_KEYWORDS', () => {
  it('is a frozen, generous table of normalised keywords', () => {
    expect(Object.isFrozen(CATEGORY_KEYWORDS)).toBe(true);
    expect(CATEGORY_KEYWORDS.length).toBeGreaterThanOrEqual(150);
    expect(CATEGORY_KEYWORDS.length).toBeLessThanOrEqual(300);
    for (const entry of CATEGORY_KEYWORDS) {
      expect(Object.isFrozen(entry)).toBe(true);
      const [keyword, category] = entry;
      expect(keyword).toMatch(/^[a-z0-9]+( [a-z0-9]+)*$/);
      expect(isCategory(category)).toBe(true);
      expect(category).not.toBe('other');
    }
  });

  it('has no duplicate keywords', () => {
    const keywords = CATEGORY_KEYWORDS.map(([k]) => k);
    expect(new Set(keywords).size).toBe(keywords.length);
  });

  it('gives every non-other category at least one keyword', () => {
    const covered = new Set(CATEGORY_KEYWORDS.map(([, c]) => c));
    for (const c of CATEGORIES) if (c !== 'other') expect(covered.has(c)).toBe(true);
  });

  it('infers each keyword’s own category when the keyword is the whole title', () => {
    for (const [keyword, category] of CATEGORY_KEYWORDS) {
      expect([keyword, inferCategory(keyword)]).toEqual([keyword, category]);
      expect([keyword, inferCategory(keyword.toUpperCase())]).toEqual([keyword, category]);
    }
  });
});

describe('inferCategory', () => {
  it.each<[string, Category]>([
    // From the brief
    ['Banff Town Parking', 'parking'],
    ['Sunshine Village lift ticket', 'activities'],
    ['Gas at Petro-Canada', 'fuel'],
    ['Uber to airport', 'transit'],
    ['Business dinner', 'food'], // "bus" must not match inside "business"
    ['BBQ supplies', 'groceries'], // "bbq supplies" (groceries) is longer than "bbq" (food)
    ['BBQ', 'food'],
    ['Barbecue at the lake', 'food'], // not "bar"
    ['Fairmont Banff Springs', 'lodging'],
    ['Starbucks', 'coffee'],
    ['', 'other'],
    ['asdfgh', 'other'],
    ['Café au lait', 'coffee'], // diacritics stripped; "cafe au lait" beats "cafe"
    ['gas station snacks', 'fuel'], // "gas station" (11) beats "snacks" (6)
    // Meals and coffee
    ['Pizza night', 'food'],
    ['Sushi for the group', 'food'],
    ['Hotel breakfast', 'food'], // "breakfast" (9) beats "hotel" (5)
    ['Uber Eats', 'food'], // "uber eats" beats "uber"
    ["McDonald's", 'food'],
    ['Fish & chips', 'food'],
    ['Café', 'food'],
    ["Tim Horton's", 'coffee'],
    ['Coffee and donuts', 'coffee'], // tie at 6 chars: earliest wins
    ['Lattes', 'coffee'], // listed plural (was 'other' before the integration review added plural forms)
    ['Parkades', 'other'], // no stemming: only listed forms match
    // Groceries and drinks
    ['Groceries at Safeway', 'groceries'],
    ["Trader Joe's run", 'groceries'],
    ['Save-On-Foods', 'groceries'],
    ['Walmart snacks', 'groceries'], // "walmart" (7) beats "snacks" (6)
    ['LCBO', 'drinks'],
    ['Beer and wine', 'drinks'],
    ['Drinks at the pub', 'drinks'],
    ['Public market', 'groceries'], // not "pub"
    // Lodging, flights, transit
    ['Airbnb Canmore', 'lodging'],
    ['Hôtel Le Germain', 'lodging'],
    ['B&B in Jasper', 'lodging'],
    ['Airbnb cleaning fee', 'lodging'], // "airbnb" (6) beats "fee" (3)
    ['WestJet YYC-YVR', 'flights'],
    ['Air Canada flight', 'flights'],
    ['Baggage fee', 'flights'],
    ['Plane tickets', 'flights'],
    ['Bus to Banff', 'transit'],
    ['Train tickets to Jasper', 'transit'], // "train tickets" beats "tickets"
    ['Uber to hotel', 'transit'], // "uber to" (7) beats "hotel" (5)
    ['Banff Gondola', 'transit'],
    ['Taxi', 'transit'],
    // Fuel, parking, rental
    ['Costco gas', 'fuel'], // beats "costco"
    ['Shell', 'fuel'],
    ['Parking ticket', 'parking'], // beats "ticket"
    ['Hotel parking', 'parking'],
    ['Car rental', 'rental'],
    ['Hertz rental car', 'rental'],
    ['U-Haul', 'rental'],
    ['Canoe rental', 'activities'], // "rental" alone is not a keyword
    // Activities, shopping, fees, health, gifts
    ['Upper Hot Springs', 'activities'],
    ['Movie tickets', 'activities'],
    ['Lake Louise canoe', 'activities'],
    ['Parks Canada pass', 'activities'],
    ['Souvenirs', 'shopping'],
    ['Gift shop', 'shopping'], // "gift shop" beats "gift"
    ['Canadian Tire', 'shopping'],
    ['Tip', 'fees'],
    ['Resort fee', 'fees'], // "resort fee" beats "resort"
    ['Bridge toll', 'fees'],
    ['Shoppers Drug Mart', 'health'], // "shoppers" is not "shop"
    ['Sunscreen', 'health'],
    ['Band-Aids', 'health'],
    ['Birthday present', 'gifts'],
    ['Flowers for Maya', 'gifts'],
    ['Gift card', 'gifts'],
    // Non-matches
    ['Las Vegas', 'other'], // not "gas"
    ['Gastown walk', 'other'],
    ['Cabinet', 'other'], // not "cab"
    ['東京', 'other'],
    ['   ', 'other'],
  ])('%j → %s', (title, expected) => {
    expect(inferCategory(title)).toBe(expected);
  });

  it('ignores case, surrounding punctuation and extra whitespace', () => {
    expect(inferCategory('  PARKING!!!  ')).toBe('parking');
    expect(inferCategory('dinner\t\n@ earls')).toBe('food');
    expect(inferCategory('(hotel)')).toBe('lodging');
    expect(inferCategory('RENTAL   CAR')).toBe('rental');
  });

  it('prefers the longest keyword regardless of category, then the earliest', () => {
    // "tickets" (7) beats "movie" (5); "gondola" (7) ties "tickets" (7) and appears first.
    expect(inferCategory('Movie tickets')).toBe('activities');
    expect(inferCategory('Gondola tickets')).toBe('transit');
    expect(inferCategory('Tickets gondola')).toBe('activities');
    expect(inferCategory('wine and beer')).toBe('drinks');
    expect(inferCategory('Tea then dinner')).toBe('food');
  });

  it('is deterministic and total (property)', () => {
    const cats = new Set<string>(CATEGORIES);
    fc.assert(
      fc.property(fc.string({ maxLength: 80, unit: 'binary' }), (title) => {
        const a = inferCategory(title);
        expect(cats.has(a)).toBe(true);
        expect(inferCategory(title)).toBe(a);
      }),
      { numRuns: 1000 },
    );
  });

  it('returns other for a non-string', () => {
    expect(inferCategory(undefined as unknown as string)).toBe('other');
  });

  it.each<[string, Category]>([
    ['Lattes for everyone', 'coffee'],
    ['Two coffees', 'coffee'],
    ['Cappuccinos', 'coffee'],
    ['Beers at the lake', 'drinks'],
    ['Wines', 'drinks'],
    ['Burgers', 'food'],
    ['Pizzas', 'food'],
    ['Lunches', 'food'],
    ['Cabs home', 'transit'],
    ['Taxis', 'transit'],
    ['Buses to Jasper', 'transit'],
    ['Trains', 'transit'],
    ['Bridge tolls', 'fees'],
    ['Tips', 'fees'],
    ['Gifts for the hosts', 'gifts'],
  ])('matches the listed plural %j → %s', (title, expected) => {
    expect(inferCategory(title)).toBe(expected);
  });

  it('degrades without String.prototype.normalize (Hermes without Intl): no diacritic folding, no throw', () => {
    const proto = String.prototype as unknown as { normalize: unknown };
    const original = proto.normalize;
    for (const replacement of [undefined, () => { throw new RangeError('unsupported'); }]) {
      proto.normalize = replacement;
      try {
        expect(inferCategory('Parking')).toBe('parking');
        expect(inferCategory('Tim Horton’s')).toBe('coffee');
        expect(() => inferCategory('Café au lait')).not.toThrow();
        expect(inferCategory('Hôtel Le Germain')).toBe('other'); // "ô" is a separator when it cannot be folded
      } finally {
        proto.normalize = original;
      }
    }
    expect(inferCategory('Hôtel Le Germain')).toBe('lodging');
  });
});

describe('categories.eval.json (the on-device model\'s labelled titles)', () => {
  const set = JSON.parse(readFileSync(new URL('./categories.eval.json', import.meta.url), 'utf8')) as {
    about: unknown;
    cases: { title: unknown; category: unknown }[];
  };

  it('holds 60 to 100 labelled titles, each a valid title with one of the sixteen categories', () => {
    expect(typeof set.about).toBe('string');
    expect(set.cases.length).toBeGreaterThanOrEqual(60);
    expect(set.cases.length).toBeLessThanOrEqual(100);
    for (const c of set.cases) {
      expect(Object.keys(c).sort()).toEqual(['category', 'title']);
      expect(typeof c.title).toBe('string');
      const title = c.title as string;
      expect(title.trim()).toBe(title);
      expect(title.length).toBeGreaterThan(0);
      expect(title.length).toBeLessThanOrEqual(LIMITS.titleMax);
      expect([title, isCategory(c.category)]).toEqual([title, true]);
    }
  });

  it('covers every category and repeats no title', () => {
    const covered = new Set(set.cases.map((c) => c.category));
    for (const c of CATEGORIES) expect([c, covered.has(c)]).toEqual([c, true]);
    const titles = set.cases.map((c) => (c.title as string).toLowerCase());
    expect(new Set(titles).size).toBe(titles.length);
  });
});
