/**
 * The sixteen fixed categories: emoji, label, and the keyword baseline for inferring one from a title
 * (design.md, "Categories"). The on-device model refinement lives in the app, not here.
 */
import { CATEGORIES, type Category } from './types.js';

export const CATEGORY_EMOJI: Readonly<Record<Category, string>> = Object.freeze({
  food: '🍽️',
  groceries: '🛒',
  drinks: '🍻',
  coffee: '☕',
  lodging: '🏨',
  flights: '✈️',
  transit: '🚕',
  fuel: '⛽',
  parking: '🅿️',
  rental: '🚗',
  activities: '🎟️',
  shopping: '🛍️',
  fees: '🧾',
  health: '💊',
  gifts: '🎁',
  other: '📌',
});

export const CATEGORY_LABEL: Readonly<Record<Category, string>> = Object.freeze({
  food: 'Food',
  groceries: 'Groceries',
  drinks: 'Drinks',
  coffee: 'Coffee',
  lodging: 'Lodging',
  flights: 'Flights',
  transit: 'Transit',
  fuel: 'Fuel',
  parking: 'Parking',
  rental: 'Rental car',
  activities: 'Activities',
  shopping: 'Shopping',
  fees: 'Fees',
  health: 'Health',
  gifts: 'Gifts',
  other: 'Other',
});

const CATEGORY_SET: ReadonlySet<string> = new Set(CATEGORIES);

export function isCategory(value: unknown): value is Category {
  return typeof value === 'string' && CATEGORY_SET.has(value);
}

// ---------- Keyword inference ----------

/**
 * Keywords are written in normalised form (see `normalize`): lowercase ASCII words separated by single spaces,
 * apostrophes dropped ("trader joes", "tim hortons") and "&" spelled "and" ("b and b" matches "B&B").
 *
 * Because the longest keyword wins, a multi-word entry is how the table overrides a shorter one:
 * "uber eats" (food) beats "uber" (transit), "parking ticket" (parking) beats "ticket", "bus ticket" (transit) beats
 * "ticket" (activities), "bbq supplies" (groceries) beats "bbq" (food), "uber to" beats "hotel" in "Uber to hotel".
 * Deliberately absent: "airport" (it would turn "Uber to airport" and "Airport parking" into flights), "rental"
 * alone (it would turn "Canoe rental" into a rental car), "birthday" (it would beat "dinner").
 *
 * No stemming: plural and variant forms are listed explicitly ("lattes", "buses", "taxis"), so the table stays the
 * whole truth and every phone infers the same thing. Add a form here rather than a rule.
 */
const KEYWORDS_BY_CATEGORY: { readonly [C in Exclude<Category, 'other'>]: readonly string[] } = {
  food: [
    'food', 'meal', 'meals', 'dinner', 'lunch', 'breakfast', 'brunch', 'restaurant', 'cafe', 'diner', 'dining',
    'pizza', 'sushi', 'burger', 'burgers', 'taco', 'tacos', 'ramen', 'pho', 'bbq', 'barbecue', 'poutine', 'sandwich',
    'takeout', 'uber eats', 'doordash', 'skip the dishes', 'mcdonalds', 'snacks', 'dessert', 'ice cream', 'bakery',
    'donuts', 'steak', 'fish and chips',
    'dinners', 'lunches', 'breakfasts', 'brunches', 'restaurants', 'pizzas', 'sandwiches', 'steaks', 'desserts',
    'snack', 'donut',
  ],
  groceries: [
    'grocery', 'groceries', 'supermarket', 'safeway', 'costco', 'walmart', 'trader joe', 'trader joes', 'whole foods',
    'loblaws', 'sobeys', 'iga', 'market', 'save on foods', 'superstore', 'convenience store', 'bbq supplies',
    'barbecue supplies',
  ],
  drinks: [
    'drinks', 'beer', 'wine', 'bar', 'pub', 'brewery', 'cocktail', 'cocktails', 'liquor', 'liquor store', 'lcbo',
    'saq', 'beer store', 'happy hour',
    'beers', 'wines', 'pubs', 'breweries',
  ],
  coffee: [
    'coffee', 'latte', 'espresso', 'cappuccino', 'flat white', 'cafe au lait', 'starbucks', 'tim hortons', 'tea',
    'coffees', 'lattes', 'espressos', 'cappuccinos', 'flat whites', 'teas',
  ],
  lodging: [
    'hotel', 'hotels', 'motel', 'hostel', 'airbnb', 'vrbo', 'lodge', 'inn', 'resort', 'cabin', 'campsite',
    'campground', 'camping', 'accommodation', 'lodging', 'b and b', 'fairmont', 'marriott', 'hilton', 'delta hotels',
  ],
  flights: [
    'flight', 'flights', 'airline', 'airfare', 'plane ticket', 'plane tickets', 'flight tickets', 'westjet',
    'air canada', 'delta', 'united', 'baggage',
  ],
  transit: [
    'uber', 'lyft', 'taxi', 'cab', 'bus', 'train', 'subway', 'metro', 'transit', 'shuttle', 'ferry', 'gondola',
    'via rail', 'greyhound', 'bus ticket', 'bus tickets', 'train ticket', 'train tickets', 'ferry ticket',
    'bc ferries', 'uber to', 'lyft to', 'taxi to', 'cab to',
    'ubers', 'lyfts', 'taxis', 'cabs', 'buses', 'trains', 'shuttles', 'ferries', 'gondolas',
  ],
  fuel: [
    'gas', 'fuel', 'petrol', 'diesel', 'shell', 'esso', 'petro canada', 'chevron', 'husky', 'gas station',
    'costco gas', 'ev charging',
  ],
  parking: ['parking', 'parkade', 'meter', 'parking lot', 'parking ticket', 'valet', 'park and ride'],
  rental: [
    'rental car', 'car rental', 'rent a car', 'hertz', 'avis', 'enterprise', 'budget rent', 'turo', 'u haul', 'uhaul',
    'campervan',
  ],
  activities: [
    'ticket', 'tickets', 'tour', 'museum', 'lift ticket', 'lift pass', 'ski pass', 'bike rental', 'canoe', 'kayak',
    'rafting', 'hike permit', 'park pass', 'parks canada', 'admission', 'entrance fee', 'spa', 'hot springs', 'zoo',
    'cinema', 'movie', 'concert', 'theatre', 'golf', 'greens fee', 'ski', 'skiing', 'sightseeing', 'massage',
  ],
  shopping: [
    'shopping', 'shop', 'store', 'clothes', 'clothing', 'souvenir', 'souvenirs', 'amazon', 'mall', 'gift shop',
    'gear', 'canadian tire', 'ikea', 'target', 'best buy',
  ],
  fees: [
    'fee', 'fees', 'toll', 'tolls', 'tip', 'tips', 'gratuity', 'service charge', 'atm', 'bank fee', 'visa', 'visa fee',
    'insurance', 'permit', 'tax', 'taxes', 'currency exchange', 'cancellation fee', 'resort fee', 'sim card',
  ],
  health: [
    'pharmacy', 'drugstore', 'medicine', 'medication', 'doctor', 'clinic', 'hospital', 'dentist', 'sunscreen',
    'shoppers drug mart', 'london drugs', 'band aid', 'band aids', 'bandaid', 'first aid', 'advil', 'tylenol',
    'prescription',
  ],
  gifts: ['gift', 'gifts', 'present', 'presents', 'flowers', 'florist', 'donation'],
};

export const CATEGORY_KEYWORDS: ReadonlyArray<readonly [keyword: string, category: Category]> = Object.freeze(
  CATEGORIES.flatMap((category) =>
    category === 'other'
      ? []
      : KEYWORDS_BY_CATEGORY[category].map((keyword) => Object.freeze([keyword, category] as const)),
  ),
);

/** Combining diacritical marks (the blocks NFD produces for Latin, Greek and Cyrillic letters). */
const COMBINING_MARKS = /[̀-ͯ᪰-᫿᷀-᷿⃐-⃿︠-︯]/g;
const APOSTROPHES = /['`‘’ʼ]/g;
const NON_WORD = /[^a-z0-9]+/g;

/**
 * Canonical decomposition, used only to fold diacritics. Hermes may lack `String.prototype.normalize`, depending on
 * its version and build (README "Verify on device"); then titles are matched unfolded and an accented letter acts as a word separator
 * ("Café" no longer reads as "cafe"), instead of inference throwing on every keystroke.
 */
function decompose(text: string): string {
  if (typeof text.normalize !== 'function') return text;
  try {
    return text.normalize('NFD');
  } catch {
    return text;
  }
}

/**
 * NFD, drop combining marks, lowercase (locale-independent `toLowerCase`), drop apostrophes, "&" → "and", every run
 * of other characters → one space, trim. "Café au lait" → "cafe au lait", "Tim Horton's" → "tim hortons",
 * "Petro-Canada" → "petro canada". Characters outside a–z/0–9 that do not decompose (ø, ß, CJK) act as separators.
 */
function normalize(text: string): string {
  return decompose(text)
    .replace(COMBINING_MARKS, '')
    .toLowerCase()
    .replace(APOSTROPHES, '')
    .replace(/&/g, ' and ')
    .replace(NON_WORD, ' ')
    .trim();
}

interface PreparedKeyword {
  readonly needle: string; // " keyword ", so indexOf on " title " matches whole words only
  readonly length: number;
  readonly category: Category;
}

const PREPARED: readonly PreparedKeyword[] = CATEGORY_KEYWORDS.map(([keyword, category]) => {
  const norm = normalize(keyword);
  return { needle: ` ${norm} `, length: norm.length, category };
});

/**
 * Keyword inference: lowercase, word-boundary match, longest keyword wins, 'other' when nothing matches. Deterministic, offline.
 *
 * The longest matching keyword (in normalised characters) wins regardless of category; among equally long matches
 * the one that starts earliest in the title wins. Two different keywords cannot tie on both, so the result is unique.
 */
export function inferCategory(title: string): Category {
  if (typeof title !== 'string') return 'other';
  const norm = normalize(title);
  if (norm === '') return 'other';
  const haystack = ` ${norm} `;
  let best: { length: number; pos: number; category: Category } | null = null;
  for (const k of PREPARED) {
    const pos = haystack.indexOf(k.needle);
    if (pos === -1) continue;
    if (best === null || k.length > best.length || (k.length === best.length && pos < best.pos)) {
      best = { length: k.length, pos, category: k.category };
    }
  }
  return best?.category ?? 'other';
}
