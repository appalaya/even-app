/**
 * Event body validation (design.md "Validation"). Every decrypted body passes `parseEvent` before the reducer sees it.
 *
 * Deterministic and platform-independent by construction: no `Intl`, no `Date` parsing, no locale functions, and no
 * Unicode property escapes (`\p{…}`), whose answers depend on the engine's Unicode tables. Every character set this
 * file depends on is written out below.
 *
 * Length rules count Unicode code points (a lone surrogate counts as one), never UTF-16 code units or graphemes.
 * Code points are stable across engines, and any string a UTF-16-counting text field allows is within the bound.
 */
import { z } from 'zod';
import { LIMITS } from './constants.js';
import { canonicalOrigin } from './keys.js';
import { CATEGORIES, type Event } from './types.js';

// ---------- Primitive rules ----------

const ID_RE = /^[A-Za-z0-9_-]{22}$/; // member, expense, payment, device ids (LIMITS.idLength)
const LOCAL_ID_RE = /^[A-Za-z0-9_-]{43}$/; // local group id: base64url of 32 bytes (design.md "Identity model")
const CURRENCY_RE = /^[A-Z]{3}$/; // shape only; money.ts owns the ISO 4217 table
const ISO_DATE_RE = /^([0-9]{4})-([0-9]{2})-([0-9]{2})$/;

/**
 * Leading or trailing whitespace. The set is ECMAScript's WhiteSpace + LineTerminator (what `String.prototype.trim`
 * strips today) written out, plus U+180E, which older engines' `trim` also stripped. A name or title that passes
 * therefore satisfies `s.trim() === s` on every engine, old or new.
 */
const WS = '\\t\\n\\v\\f\\r \\u00A0\\u1680\\u180E\\u2000-\\u200A\\u2028\\u2029\\u202F\\u205F\\u3000\\uFEFF';
const EDGE_WHITESPACE_RE = new RegExp(`^[${WS}]|[${WS}]$`);

/**
 * Bidirectional-control characters: the embeddings and overrides U+202A–U+202E and the isolates U+2066–U+2069
 * (pre-launch review L4). One in a name, title or note reorders the text around it wherever it is shown (the Join
 * preview, a notification, Activity), so a member could make one line read as another. Refused in every free-text
 * field of an event and in `makeInvite`'s `g`. A tightening: an event written before it with one is now invalid like
 * any other, and is never rewritten. The marks U+200E, U+200F and U+061C, which only nudge neutral characters, stay.
 */
const BIDI_CONTROL_RE = /[\u202A-\u202E\u2066-\u2069]/;

/** Whether `text` holds a bidirectional-control character (U+202A–U+202E, U+2066–U+2069). Never throws. */
export function hasBidiControl(text: string): boolean {
  return typeof text === 'string' && BIDI_CONTROL_RE.test(text);
}

function codePointLength(text: string): number {
  let n = 0;
  for (const _ of text) n++;
  return n;
}

/**
 * 1..max code points, no leading or trailing whitespace (so a whitespace-only string is rejected too), and no
 * bidirectional-control character.
 */
function isTrimmedText(text: string, max: number): boolean {
  const n = codePointLength(text);
  return n >= 1 && n <= max && !EDGE_WHITESPACE_RE.test(text) && !BIDI_CONTROL_RE.test(text);
}

/**
 * The group-name rule (group.created, group.renamed; makeInvite's `g`): 1..LIMITS.groupNameMax code points, trimmed,
 * no bidirectional-control character. Never throws.
 */
export function isGroupName(text: string): boolean {
  return typeof text === 'string' && isTrimmedText(text, LIMITS.groupNameMax);
}

const DAYS_IN_MONTH = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31] as const;

/**
 * The validator's date rule: `YYYY-MM-DD` with ASCII digits, a real Gregorian calendar date, year 2000..2099.
 * Pure string and integer arithmetic; never touches `Date`.
 */
export function isIsoDate(text: string): boolean {
  if (typeof text !== 'string') return false;
  const m = ISO_DATE_RE.exec(text);
  if (m === null) return false;
  const year = Number(m[1]);
  const month = Number(m[2]);
  const day = Number(m[3]);
  if (year < 2000 || year > 2099 || month < 1 || month > 12 || day < 1) return false;
  const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  const max = month === 2 && leap ? 29 : (DAYS_IN_MONTH[month - 1] ?? 0);
  return day <= max;
}

/**
 * Unicode `Extended_Pictographic` (emoji-data.txt, Unicode 17.0), as hex code points and inclusive ranges.
 * Written out rather than `\p{Extended_Pictographic}` so every engine (Hermes, JSC, V8) and every Unicode version
 * gives the same answer. The property pre-reserves unassigned code points in the emoji blocks, so emoji added in
 * future Unicode versions are already covered. schema.test.ts checks this table against the runtime's property.
 */
const EXTENDED_PICTOGRAPHIC =
  'A9 AE 203C 2049 2122 2139 2194-2199 21A9-21AA 231A-231B 2328 23CF 23E9-23F3 23F8-23FA 24C2 25AA-25AB 25B6 25C0 ' +
  '25FB-25FE 2600-2604 260E 2611 2614-2615 2618 261D 2620 2622-2623 2626 262A 262E-262F 2638-263A 2640 2642 ' +
  '2648-2653 265F-2660 2663 2665-2666 2668 267B 267E-267F 2692-2697 2699 269B-269C 26A0-26A1 26A7 26AA-26AB ' +
  '26B0-26B1 26BD-26BE 26C4-26C5 26C8 26CE-26CF 26D1 26D3-26D4 26E9-26EA 26F0-26F5 26F7-26FA 26FD 2702 2705 ' +
  '2708-270D 270F 2712 2714 2716 271D 2721 2728 2733-2734 2744 2747 274C 274E 2753-2755 2757 2763-2764 2795-2797 ' +
  '27A1 27B0 27BF 2934-2935 2B05-2B07 2B1B-2B1C 2B50 2B55 3030 303D 3297 3299 1F004 1F02C-1F02F 1F094-1F09F ' +
  '1F0AF-1F0B0 1F0C0 1F0CF-1F0D0 1F0F6-1F0FF 1F170-1F171 1F17E-1F17F 1F18E 1F191-1F19A 1F1AE-1F1E5 1F201-1F20F ' +
  '1F21A 1F22F 1F232-1F23A 1F23C-1F23F 1F249-1F25F 1F266-1F321 1F324-1F393 1F396-1F397 1F399-1F39B 1F39E-1F3F0 ' +
  '1F3F3-1F3F5 1F3F7-1F3FA 1F400-1F4FD 1F4FF-1F53D 1F549-1F54E 1F550-1F567 1F56F-1F570 1F573-1F57A 1F587 ' +
  '1F58A-1F58D 1F590 1F595-1F596 1F5A4-1F5A5 1F5A8 1F5B1-1F5B2 1F5BC 1F5C2-1F5C4 1F5D1-1F5D3 1F5DC-1F5DE 1F5E1 ' +
  '1F5E3 1F5E8 1F5EF 1F5F3 1F5FA-1F64F 1F680-1F6C5 1F6CB-1F6D2 1F6D5-1F6E5 1F6E9 1F6EB-1F6F0 1F6F3-1F6FF ' +
  '1F7DA-1F7FF 1F80C-1F80F 1F848-1F84F 1F85A-1F85F 1F888-1F88F 1F8AE-1F8AF 1F8BC-1F8BF 1F8C2-1F8CF 1F8D9-1F8FF ' +
  '1F90C-1F93A 1F93C-1F945 1F947-1F9FF 1FA58-1FA5F 1FA6E-1FAFF 1FC00-1FFFD';

const EP = `[${EXTENDED_PICTOGRAPHIC.split(' ')
  .map((range) => range.split('-').map((hex) => `\\u{${hex}}`).join('-'))
  .join('')}]`;
const VS16 = '\\u{FE0F}';
const ZWJ = '\\u{200D}';
const SKIN_TONE = '[\\u{1F3FB}-\\u{1F3FF}]'; // Emoji_Modifier
const TAG_SPEC = '[\\u{E0020}-\\u{E007E}]+\\u{E007F}'; // subdivision flags, e.g. England
const REGIONAL_INDICATOR = '[\\u{1F1E6}-\\u{1F1FF}]';
/** One pictographic element: base, optional VS16 or skin tone, optional tag sequence. */
const ELEMENT = `${EP}(?:${VS16}|${SKIN_TONE})?(?:${TAG_SPEC})?`;
/** UTS #51 shapes: a flag (two regional indicators), a keycap, or elements joined by ZWJ. */
const SINGLE_EMOJI_RE = new RegExp(
  `^(?:${REGIONAL_INDICATOR}{2}|[0-9#*]${VS16}\\u{20E3}|${ELEMENT}(?:${ZWJ}${ELEMENT})*)$`,
  'u',
);
const EMOJI_MAX_CODE_POINTS = 16; // design.md Member.emoji

/** Exactly one emoji grapheme cluster, at most 16 code points. */
export function isSingleEmoji(text: string): boolean {
  if (typeof text !== 'string' || text.length === 0) return false;
  if (codePointLength(text) > EMOJI_MAX_CODE_POINTS) return false;
  return SINGLE_EMOJI_RE.test(text);
}

/**
 * Canonical https origin (PROTOCOL.md §8.1), by the one definition the package has: a string is canonical iff
 * keys.ts's `canonicalOrigin` maps it to itself. So `group.moved.server`, the invite's `s`, and the `origin` fed to
 * `deriveServer` can never disagree. Never throws.
 */
function isCanonicalOrigin(text: string): boolean {
  try {
    return canonicalOrigin(text) === text;
  } catch {
    return false;
  }
}

/** Non-empty, at most LIMITS.membersMax entries, values sum exactly to `amount`. Never throws. */
function isSplitFor(amount: unknown, split: unknown): boolean {
  if (typeof amount !== 'number' || typeof split !== 'object' || split === null) return false;
  const values = Object.values(split);
  if (values.length === 0 || values.length > LIMITS.membersMax) return false;
  let sum = 0;
  for (const v of values) {
    if (typeof v !== 'number') return false;
    sum += v;
    // Values are non-negative, so stop as soon as the sum passes `amount`; this also keeps `sum` exact (< 2^53).
    if (sum > amount) return false;
  }
  return sum === amount;
}

function isNonEmpty(value: object): boolean {
  return Object.keys(value).length > 0;
}

// ---------- Zod schemas ----------

const Id = z.string().regex(ID_RE);
const LocalId = z.string().regex(LOCAL_ID_RE);
const Timestamp = z.int().gte(LIMITS.tsMin).lt(LIMITS.tsMax);
const Amount = z.int().gte(LIMITS.amountMin).lte(LIMITS.amountMax);
const Currency = z.string().regex(CURRENCY_RE);
const IsoDate = z.string().refine(isIsoDate);
const Name = z.string().refine((s) => isTrimmedText(s, LIMITS.nameMax));
const GroupName = z.string().refine(isGroupName);
const Title = z.string().refine((s) => isTrimmedText(s, LIMITS.titleMax));
const Note = z.string().refine((s) => codePointLength(s) <= LIMITS.noteMax && !BIDI_CONTROL_RE.test(s));
const Emoji = z.string().refine(isSingleEmoji);
const Category = z.enum(CATEGORIES);
const Server = z.string().refine(isCanonicalOrigin);
/**
 * Member id → non-negative safe-integer minor units. Sum and size are checked by the enclosing object.
 * `-0` (JSON text "-0" parses to it) is normalised to 0, so every device holds the identical value.
 */
const Split = z.record(Id, z.int().gte(0).transform((v) => (v === 0 ? 0 : v)));

const MemberSchema = z.object({
  id: Id,
  name: Name,
  emoji: Emoji.exactOptional(),
});

const ExpenseSchema = z
  .object({
    id: Id,
    title: Title,
    amount: Amount,
    currency: Currency,
    paidBy: Id,
    date: IsoDate,
    category: Category,
    note: Note.exactOptional(),
    split: Split,
  })
  .refine((e) => isSplitFor(e.amount, e.split));

const PaymentSchema = z
  .object({
    id: Id,
    from: Id,
    to: Id,
    amount: Amount,
    currency: Currency,
    date: IsoDate,
    note: Note.exactOptional(),
  })
  .refine((p) => p.from !== p.to);

const expenseChangeFields = {
  title: Title.exactOptional(),
  paidBy: Id.exactOptional(),
  date: IsoDate.exactOptional(),
  category: Category.exactOptional(),
  note: Note.exactOptional(),
};

/**
 * Strict: any key outside the Expense fields (including `id` and `currency`) rejects. `amount` and `split` are one
 * field: the first branch requires both (and the sum rule), the second admits neither.
 */
const ExpenseChangesSchema = z
  .union([
    z
      .strictObject({ ...expenseChangeFields, amount: Amount, split: Split })
      .refine((c) => isSplitFor(c.amount, c.split)),
    z.strictObject(expenseChangeFields),
  ])
  .refine(isNonEmpty);

const MemberChangesSchema = z
  .strictObject({
    name: Name.exactOptional(),
    emoji: Emoji.nullable().exactOptional(),
  })
  .refine(isNonEmpty);

const base = {
  sv: z.literal(1),
  ts: Timestamp,
  at: Timestamp,
  by: Id,
  dev: Id,
};

/**
 * Every v1 event. Objects strip unknown keys (additive fields ride on the current `sv`); the two `changes` objects are
 * strict. Unknown `sv` or `type` fails.
 */
export const EventSchema = z.discriminatedUnion('type', [
  z.object({ ...base, type: z.literal('group.created'), name: GroupName, currency: Currency }),
  z.object({ ...base, type: z.literal('group.renamed'), name: GroupName }),
  z.object({ ...base, type: z.literal('group.closed'), reason: z.literal('rotated'), to: LocalId.exactOptional() }),
  z.object({ ...base, type: z.literal('group.rotated'), from: LocalId }),
  z.object({ ...base, type: z.literal('group.moved'), server: Server }),
  z.object({ ...base, type: z.literal('group.archived') }),
  z.object({ ...base, type: z.literal('group.unarchived') }),
  z.object({ ...base, type: z.literal('member.added'), member: MemberSchema }),
  z.object({ ...base, type: z.literal('member.updated'), id: Id, changes: MemberChangesSchema }),
  z.object({ ...base, type: z.literal('member.claimed'), id: Id }),
  z.object({ ...base, type: z.literal('member.archived'), id: Id }),
  z.object({ ...base, type: z.literal('member.unarchived'), id: Id }),
  z.object({ ...base, type: z.literal('member.done'), id: Id }),
  z.object({ ...base, type: z.literal('member.undone'), id: Id }),
  z.object({ ...base, type: z.literal('expense.added'), expense: ExpenseSchema }),
  z.object({ ...base, type: z.literal('expense.updated'), id: Id, changes: ExpenseChangesSchema }),
  z.object({ ...base, type: z.literal('expense.deleted'), id: Id }),
  z.object({ ...base, type: z.literal('payment.added'), payment: PaymentSchema }),
  z.object({ ...base, type: z.literal('payment.deleted'), id: Id }),
]);

// Compile-time guard: the schema's output and the Event contract in types.ts are mutually assignable.
type Assert<T extends true> = T;
type SchemaOutput = z.output<typeof EventSchema>;
type _EventSchemaMatchesContract = Assert<
  [SchemaOutput] extends [Event] ? ([Event] extends [SchemaOutput] ? true : false) : false
>;

/**
 * Validates a decrypted body (design.md "Validation"). Returns null for anything that fails, including unknown sv/type.
 * Unknown fields on known event types are STRIPPED, except inside expense.updated.changes and member.updated.changes,
 * which are strict. The result is a fresh object; the input is never returned or mutated.
 * Referential checks (does the member exist) are NOT done here; the reducer handles dangling references.
 * Never throws.
 */
export function parseEvent(json: unknown): Event | null {
  try {
    const result = EventSchema.safeParse(json);
    return result.success ? result.data : null;
  } catch {
    return null;
  }
}
