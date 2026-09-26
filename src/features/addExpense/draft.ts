/**
 * The Add expense sheet's draft, held in memory while the sheet is open, so the Split screen (a pushed route, not a
 * modal in a modal) can read the amount and title and hand its split back. Nothing here is ever written to disk:
 * the draft is plaintext and design.md allows no plaintext cache.
 *
 * `expense.tsx` creates a draft (or opens one by `?draft=<id>`), `split.tsx?draft=<id>` reads it and writes `split`
 * on Done, and the sheet deletes it when it closes.
 */
import { useCallback, useSyncExternalStore } from 'react';

import type { SplitDraft } from '@/features/split/draft';

import type { ChipState } from './chipMachine';

export interface SheetDraft {
  id: string;
  groupId: string;
  /** The expense being edited (`?edit=<id>`), or null for a new one. */
  editId: string | null;
  title: string;
  /** What the keypad has typed ("36.5"); see `amountEntry.ts`. */
  amountText: string;
  /** Null: you. */
  paidBy: string | null;
  /** YYYY-MM-DD, the day it happened. */
  date: string;
  /** Null: "Everyone, equally" over whoever is in the group at Save. */
  split: SplitDraft | null;
  /** The chip to start from (an edited expense's saved category, or a dev seed); null infers from the title. */
  chip: ChipState | null;
  /** Open with the category picker showing. */
  pickerOpen: boolean;
  /** The Split editor opens with this member's cell under the keypad. */
  splitFocus: string | null;
  /** A save error, shown under the title field. */
  error: string | null;
}

const drafts = new Map<string, SheetDraft>();
const listeners = new Map<string, Set<() => void>>();
let counter = 0;

function notify(id: string): void {
  for (const listener of [...(listeners.get(id) ?? [])]) listener();
}

export function createDraft(init: Omit<SheetDraft, 'id'>): SheetDraft {
  counter += 1;
  const draft: SheetDraft = { ...init, id: `d${Date.now().toString(36)}${counter}` };
  drafts.set(draft.id, draft);
  return draft;
}

export function getDraft(id: string | null | undefined): SheetDraft | undefined {
  return id == null ? undefined : drafts.get(id);
}

export function updateDraft(id: string, patch: Partial<Omit<SheetDraft, 'id'>>): void {
  const current = drafts.get(id);
  if (current === undefined) return;
  drafts.set(id, { ...current, ...patch });
  notify(id);
}

export function deleteDraft(id: string): void {
  if (drafts.delete(id)) notify(id);
}

function subscribe(id: string, listener: () => void): () => void {
  let set = listeners.get(id);
  if (set === undefined) {
    set = new Set();
    listeners.set(id, set);
  }
  set.add(listener);
  return () => {
    set.delete(listener);
    if (set.size === 0) listeners.delete(id);
  };
}

/** The draft, re-rendering when it changes; undefined once it is gone. */
export function useDraft(id: string | null): SheetDraft | undefined {
  const sub = useCallback(
    (listener: () => void) => (id === null ? () => undefined : subscribe(id, listener)),
    [id],
  );
  const get = useCallback(() => getDraft(id), [id]);
  return useSyncExternalStore(sub, get);
}

/** Today on this phone, as YYYY-MM-DD. */
export function todayIso(now: Date = new Date()): string {
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, '0');
  const d = String(now.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}
