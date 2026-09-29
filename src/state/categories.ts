/**
 * Category helpers for the add-expense sheet (design.md "Categories", "Model refinement", "Chip state machine").
 *
 * The UI owns the category chip. This module gives it the inference sources (history, the keyword table, the
 * on-device model) and the transition rules as pure functions, so the contract is written once and tested:
 *
 * The chip holds `{ category, source }` with `source ∈ keyword | model | user`, and the model's pick also the title
 * the model answered (`CategoryChip`):
 * - A user tap sets `source = user`, cancels any in-flight model request, and drops any reply that arrives
 *   afterwards. Later title edits do not re-infer (`chipAfterTap`). `user` is sticky until the sheet is dismissed.
 * - While `source` is `keyword` or `model`, every keystroke runs instant inference (history first, then the keyword
 *   table: `guessCategory`) (`chipAfterTitle`). A guess that stands (history, or keywords of one category) is
 *   applied immediately with `source = keyword`. A guess the model decides (`needsModel`) keeps the model's pick
 *   (`source` stays `model`) while the new title continues the one the model answered (`continuesTitle`: the person
 *   is extending it or backspacing through it); otherwise it is applied with `source = keyword`. So the chip does not
 *   bounce back to the local guess with each keystroke between pauses.
 * - When the user pauses typing (500 ms), and while `source` is not `user`, the UI asks the model (`refineCategory`)
 *   about a title whose local guess does not stand (`needsModel`: neither history nor the table knows it, or the
 *   table found keywords of two categories in it), and remembers the exact title it asked about (`shouldRefine`).
 * - The model's `other` is no answer (`refineCategory` returns null), so the chip keeps its local guess with no
 *   sparkle rather than suggesting Other.
 * - A reply is applied only if that title still matches the field and `source` is not `user`; otherwise it is
 *   discarded (`chipAfterReply`). An applied reply sets `source = model` and remembers the title it answered, so a
 *   model result can be refined by a later model result but never overwrite a tap. A reply that agrees with the
 *   model's pick changes nothing the person sees; one that differs swaps the chip (the swap animates, UI).
 * - While `source` is `model` the chip carries the sparkle, with no timer (`carriesSparkle`), so a choice the user
 *   did not make is never invisible. A keyword-inferred chip and a chip the user chose never carry it: a tap takes
 *   it away (the UI fades it out) and a keystroke whose guess is applied drops it. When the model changes the chip,
 *   the swap animates (UI: `features/addExpense/chipMachine.ts`).
 * - Tapping Save freezes the chip: the event carries whatever it shows, never a later guess, and the chip keeps
 *   what it shows, the sparkle included (UI).
 * Replies and taps are both handled on the JavaScript thread in arrival order, so a tap is never lost.
 *
 * Only the on-device model is ever used; a title never leaves the phone (design.md "Model refinement"). Each
 * availability check and each model reply is logged with `console.log` (outcome, category, milliseconds, model), never
 * the title (design.md "Reading the logs").
 */
import {
  inferCategory as inferFromKeywords,
  isCategory,
  keywordMatches,
  recallCategory,
  rememberCategories,
  type Category,
  type CategoryMemory,
  type GroupState,
} from '@even/core';

import type {
  ClassifierAvailability,
  ClassifierOutcome,
} from '../../modules/even-classifier/src/EvenClassifier.types';

// ---------- History first ----------

/**
 * Where the chip's history comes from: the reduced states of the groups this process holds in memory, the open
 * group's first (`GroupStateStore.peekStates`, installed by `openAppServices.ts`). History is the expenses already in
 * each group's decrypted log, so it needs no storage of its own: nothing is read from disk and nothing is written.
 * The index over each state lives in memory, keyed by the state object, and goes when the state is replaced.
 */
export type CategoryHistorySource = (openGroup: string | null) => readonly GroupState[];

let historySource: CategoryHistorySource | null = null;
let openGroup: string | null = null;
const memories = new WeakMap<GroupState, CategoryMemory>();

function memoryOf(state: GroupState): CategoryMemory {
  let memory = memories.get(state);
  if (memory === undefined) {
    const past = [...state.expenses.values()].map((e) => ({
      title: e.title,
      category: e.category,
      at: e.updatedAt,
    }));
    memory = rememberCategories(past);
    memories.set(state, memory);
  }
  return memory;
}

/** Installs the history source (the app, once services are open) or a stub (tests); null removes it. */
export function setCategoryHistory(source: CategoryHistorySource | null): void {
  historySource = source;
}

/** The category saved with the same or a similar title earlier (`recallCategory`), or null. Never throws. */
function recall(title: string): Category | null {
  if (historySource === null) return null;
  try {
    return recallCategory(title, historySource(openGroup).map(memoryOf))?.category ?? null;
  } catch {
    return null;
  }
}

/** Where the chip's instant guess came from: `history`, the keyword `table`, or `none` (the table found nothing). */
export type GuessSource = 'history' | 'table' | 'none';

/** The chip's instant guess and the evidence behind it. */
export interface LocalGuess {
  category: Category;
  from: GuessSource;
  /**
   * The table found keywords of two or more categories in the title ("Hotel bar": hotel → lodging, bar → drinks);
   * the longest one gave `category`. Always false for `history` and `none`.
   */
  mixed: boolean;
}

/**
 * The chip's instant guess for `title`, on every keystroke: the category saved with the same or a similar title
 * earlier (this group first, then any group on this phone), else the keyword table's, else `other`.
 */
export function guessCategory(title: string): LocalGuess {
  const recalled = recall(title);
  if (recalled !== null) return { category: recalled, from: 'history', mixed: false };
  const category = inferFromKeywords(title);
  if (category === 'other') return { category, from: 'none', mixed: false };
  const mixed = new Set(keywordMatches(title).map((m) => m.category)).size > 1;
  return { category, from: 'table', mixed };
}

/**
 * Whether the model decides a title with this local guess (the gate, design.md "Model refinement"): when neither
 * history nor the table knows the title, or when the table found keywords of two categories in it ("Hotel bar",
 * "Gas station snacks"). A history hit, and a keyword hit of one category, stand: measured, asking the model about
 * those as well undid right chips ("Banff Upper Hot Springs" → health) for no gain on the held-out titles.
 */
export function needsModel(guess: LocalGuess): boolean {
  return guess.from === 'none' || guess.mixed;
}

/**
 * Instant inference: history first, then the keyword table (deterministic, offline, identical on every phone);
 * `other` when neither knows the title. With no history installed it is the table alone.
 */
export function inferCategory(title: string): Category {
  return guessCategory(title).category;
}

/**
 * The phone's on-device model, as `refineCategory` uses it: the `even-classifier` native module in the app
 * (installed by `openAppServices.ts`), a stub in tests. iOS answers with Foundation Models' on-device system model
 * (never Private Cloud Compute, never a cloud provider); Android reports unavailable for now.
 */
export interface OnDeviceModel {
  availability(): Promise<ClassifierAvailability>;
  /**
   * The reply (`ClassifierReply`: category, outcome, ms, model); resolves within the native timeout (6 s on iOS). Typed
   * `unknown` because every field is checked here before it is used or logged.
   */
  classifyExpense(title: string): Promise<unknown>;
  /** Loads the model ahead of the first title. */
  prewarm?(): Promise<void>;
}

/** Where the refiner's diagnostics go: `console.log` in the app, a recorder in tests. Never given the title. */
export type ModelLog = (line: string) => void;

const consoleLog: ModelLog = (line) => console.log(line);

const OUTCOMES: ReadonlySet<string> = new Set<ClassifierOutcome>([
  'answered',
  'other',
  'refused',
  'timeout',
  'error',
  'unavailable',
  'blank',
]);

/** A word the native side may report (a model, a reason, an error kind); anything else is not logged. */
const TOKEN = /^[A-Za-z][A-Za-z0-9]{0,39}$/;

function token(value: unknown): string | null {
  return typeof value === 'string' && TOKEN.test(value) ? value : null;
}

/**
 * A native reply, checked field by field: the category only when the outcome is `answered` and it is one of the
 * sixteen ids other than `other`; `other` from the model (as the category or the outcome) is no answer. Anything
 * malformed is an `error` with no category. Only the checked fields reach the log, so nothing the native side
 * returns can put a title there.
 */
function readReply(value: unknown): {
  category: Category | null;
  outcome: ClassifierOutcome;
  model: string | null;
  detail: string | null;
} {
  if (typeof value !== 'object' || value === null) {
    return { category: null, outcome: 'error', model: null, detail: 'malformedReply' };
  }
  const reply = value as Record<string, unknown>;
  const said =
    typeof reply.outcome === 'string' && OUTCOMES.has(reply.outcome)
      ? (reply.outcome as ClassifierOutcome)
      : null;
  const model = token(reply.model);
  const detail = token(reply.detail);
  if (reply.category === 'other' || said === 'other') {
    return { category: null, outcome: 'other', model, detail };
  }
  if (said === 'answered') {
    return isCategory(reply.category)
      ? { category: reply.category, outcome: 'answered', model, detail }
      : { category: null, outcome: 'error', model, detail: 'notACategory' };
  }
  return {
    category: null,
    outcome: said ?? 'error',
    model,
    detail: said === null ? 'malformedReply' : detail,
  };
}

export interface CategoryRefiner {
  /** Add expense opened: check availability now and, if the model is there, load it before the first title. */
  prepare(): void;
  /** The model's category for `title`, or null. */
  refine(title: string): Promise<Category | null>;
}

/** Every diagnostics line starts with this, so a tester can filter Console.app on it. */
export const MODEL_LOG_PREFIX = '[even] category model';

/**
 * The model's two uses, bound to `model` (null: no model). Availability is asked once and kept for the session:
 * unavailable, or an availability call that fails, means null for every title without asking the model. The model's
 * `other`, an answer that is not one of the sixteen category ids, a refusal, a timeout, a rejection, or a throw is
 * null too, so the local guess stands. A model that becomes ready later (Apple Intelligence just turned on) is used
 * from the next launch. Each availability check and each reply is logged to `log`, never the title.
 */
export function createCategoryRefiner(
  model: OnDeviceModel | null,
  log: ModelLog = consoleLog,
): CategoryRefiner {
  // Diagnostics never cost an answer: a log that throws is ignored.
  const say = (line: string): void => {
    try {
      log(line);
    } catch {
      // nothing to do
    }
  };
  let usable: Promise<boolean> | null = null;
  const isUsable = (): Promise<boolean> => {
    if (model === null) return Promise.resolve(false);
    usable ??= Promise.resolve()
      .then(() => model.availability())
      .then(
        (availability) => {
          const available = availability?.status === 'available';
          const reason = available
            ? ''
            : ` reason=${token((availability as { reason?: unknown } | undefined)?.reason) ?? 'unknown'}`;
          say(
            `${MODEL_LOG_PREFIX} availability ${available ? 'available' : 'unavailable'}${reason}`,
          );
          return available;
        },
        () => {
          say(`${MODEL_LOG_PREFIX} availability unavailable reason=checkFailed`);
          return false;
        },
      );
    return usable;
  };
  return {
    prepare() {
      void isUsable()
        .then((yes) => (yes ? model?.prewarm?.() : undefined))
        .catch(() => undefined);
    },
    async refine(title) {
      if (model === null || title.trim() === '' || !(await isUsable())) return null;
      const started = Date.now();
      let reply: ReturnType<typeof readReply>;
      try {
        reply = readReply(await model.classifyExpense(title));
      } catch {
        reply = { category: null, outcome: 'error', model: null, detail: 'nativeCallFailed' };
      }
      const parts = [
        `outcome=${reply.outcome}`,
        `category=${reply.category ?? '-'}`,
        `ms=${Date.now() - started}`,
        `model=${reply.model ?? '-'}`,
      ];
      if (reply.detail !== null) parts.push(`detail=${reply.detail}`);
      say(`${MODEL_LOG_PREFIX} ${parts.join(' ')}`);
      return reply.category;
    },
  };
}

let refiner = createCategoryRefiner(null);

/**
 * Installs the on-device model (the app, once per process) or a stub (tests); null removes it. `log` receives the
 * diagnostics (default `console.log`).
 */
export function setOnDeviceModel(model: OnDeviceModel | null, log?: ModelLog): void {
  refiner = createCategoryRefiner(model, log);
}

/**
 * Add expense opened with a chip that may still be inferred: get the model ready before the first title, and look up
 * history in `groupId` (the open group) before the others.
 */
export function prepareCategoryModel(groupId: string | null = null): void {
  openGroup = groupId;
  refiner.prepare();
}

/**
 * The on-device model's answer for `title`, or null when there is no model, it is unavailable, it answers `other`, or
 * it has no valid answer (a refusal, a timeout, an error). The chip controller calls this after the 500 ms pause
 * (`features/addExpense/chipMachine.ts`).
 */
export function refineCategory(title: string): Promise<Category | null> {
  return refiner.refine(title);
}

export type ChipSource = 'keyword' | 'model' | 'user';

/**
 * The chip: the category it shows and where that came from. The model's pick also remembers the title the model
 * answered (the asked title of the reply that set or last confirmed it), which is how a keystroke tells a title being
 * extended or backspaced from a new one (`chipAfterTitle`).
 */
export type CategoryChip =
  | { category: Category; source: 'keyword' | 'user' }
  | { category: Category; source: 'model'; answeredTitle: string };

/** The chip for a fresh sheet (or an edited expense, which starts from its saved category as `user`). */
export function initialChip(title: string, saved?: Category): CategoryChip {
  return saved === undefined
    ? { category: inferCategory(title), source: 'keyword' }
    : { category: saved, source: 'user' };
}

/**
 * The sparkle: the chip carries it exactly while it shows the model's pick and the user has not tapped it. It is
 * derived from `source`, never timed; a keystroke whose local guess is applied (back to `keyword`) or a tap (`user`)
 * takes it away.
 */
export function carriesSparkle(chip: Pick<CategoryChip, 'source'>): boolean {
  return chip.source === 'model';
}

/**
 * Whether `title` continues `answeredTitle`, the title the model was asked about: one starts with the other after
 * trimming and case folding, so the person is extending it ("Surly" → "Surly's brewing") or backspacing through it.
 * An empty title continues nothing: clearing the field and typing again starts over.
 */
export function continuesTitle(answeredTitle: string, title: string): boolean {
  const asked = answeredTitle.trim().toLowerCase();
  const now = title.trim().toLowerCase();
  return now !== '' && (now.startsWith(asked) || asked.startsWith(now));
}

/**
 * A keystroke, unless the user chose. History and the keyword table run first: a guess that stands replaces a keyword
 * or model chip at once (`source = keyword`). A guess the model decides (`needsModel`) keeps the model's pick while
 * the title continues the one the model answered (the next pause asks the model about the new title); otherwise the
 * guess replaces the chip.
 */
export function chipAfterTitle(chip: CategoryChip, title: string): CategoryChip {
  if (chip.source === 'user') return chip;
  const guess = guessCategory(title);
  if (chip.source === 'model' && needsModel(guess) && continuesTitle(chip.answeredTitle, title)) {
    return chip;
  }
  return guess.category === chip.category && chip.source === 'keyword'
    ? chip
    : { category: guess.category, source: 'keyword' };
}

/** A tap on the chip: the user's choice wins from now on. */
export function chipAfterTap(chip: CategoryChip, category: Category): CategoryChip {
  return chip.source === 'user' && chip.category === category ? chip : { category, source: 'user' };
}

/**
 * Whether a pause in typing should ask the model about `title`: unless the user chose, and only when the local guess
 * does not stand (`needsModel`: neither history nor the table knows the title, or the table found keywords of two
 * categories in it).
 */
export function shouldRefine(chip: CategoryChip, title: string): boolean {
  return chip.source !== 'user' && title.trim() !== '' && needsModel(guessCategory(title));
}

/**
 * A model reply for `askedTitle`: applied only if the field still shows that exact title and the source is not
 * `user` (so a later model reply refines an earlier one); otherwise the chip is returned unchanged (the reply is
 * dropped). An applied reply makes the chip the model's pick for `askedTitle`; one that agrees with the model's
 * pick changes only the title it remembers.
 */
export function chipAfterReply(
  chip: CategoryChip,
  currentTitle: string,
  reply: { askedTitle: string; category: Category | null },
): CategoryChip {
  if (reply.category === null) return chip;
  if (chip.source === 'user' || reply.askedTitle !== currentTitle) return chip;
  return chip.source === 'model' &&
    chip.category === reply.category &&
    chip.answeredTitle === reply.askedTitle
    ? chip
    : { category: reply.category, source: 'model', answeredTitle: reply.askedTitle };
}
