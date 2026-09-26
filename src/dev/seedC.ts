/**
 * Dev seed for screen stack C (Add expense, Category picker, Split, Settle): "Banff 2026" with You (Sam), Maya,
 * Jordan (🏂) and Nathan, staged through the store the way a sync delivers a group, so every sheet reads it as it
 * reads a real one. Member ids are drawn until their avatar colour lands on the boards' slots (Sam violet, Maya clay,
 * Nathan steel). Offline: nothing needs the server. Opened by `src/app/dev/seed-c.tsx`
 * (`com.appalaya.even://dev/seed-c?screen=split&mode=equal`).
 *
 * The group's secret derives from a fixed key, so seeding again replaces it instead of adding another. Two expenses
 * leave you owing $52.00, as the dimmed Group screen behind the boards reads: Maya's gas ($80.00, four ways) and
 * Maya's dinner ($96.00, you, Maya and Jordan), which `screen=edit` opens.
 */
import {
  deriveLocal,
  deriveServer,
  memberColor,
  newId,
  parseEvent,
  PROTOCOL,
  seal,
  utf8Encode,
  type Category,
  type Event,
  type EventPayload,
} from '@even/core';

import { initialChipState } from '@/features/addExpense/chipMachine';
import { createDraft, todayIso, type SheetDraft } from '@/features/addExpense/draft';
import {
  equalDraft,
  setAmount,
  setBps,
  setExtra,
  setWeight,
  toggleMember,
  type SplitDraft,
} from '@/features/split/draft';

import { router, type Href } from 'expo-router';

import type { NewEventRow } from '../services/storage/types';
import type { AppServices } from '../state';

/** Palette slots (src/theme/themes.ts `avatarPalette` order). */
const CLAY = 1;
const OCHRE = 2;
const STEEL = 8;
const VIOLET = 10;

export interface BanffC {
  localId: string;
  sam: string;
  maya: string;
  jordan: string;
  nathan: string;
  dinnerId: string;
}

function memberIdFor(slot: number): string {
  for (;;) {
    const id = newId();
    if (memberColor(id) === slot) return id;
  }
}

function secretFor(key: string): Uint8Array {
  const bytes = new Uint8Array(32);
  bytes.set(utf8Encode(`even-dev-seed-c/${key}`.padEnd(32, '.').slice(0, 32)));
  return bytes;
}

/** Writes Banff 2026 (replacing an earlier seed-c copy). */
export async function seedBanff(services: AppServices): Promise<BanffC> {
  const { store, secrets, groups, groupState, deviceId } = services;
  const serverUrl = PROTOCOL.defaultServer;
  const secret = secretFor('banff');
  const { localId, encryptionKey } = deriveLocal(secret);
  if ((await store.getGroup(localId)) !== null) await groups.leaveGroup(localId);
  const { groupId } = deriveServer(secret, serverUrl);

  const sam = memberIdFor(VIOLET);
  const maya = memberIdFor(CLAY);
  const jordan = memberIdFor(OCHRE);
  const nathan = memberIdFor(STEEL);
  const devices: Record<string, string> = {
    [sam]: deviceId,
    [maya]: newId(),
    [jordan]: newId(),
    [nathan]: newId(),
  };
  const dinnerId = newId();
  const now = Date.now();
  const start = now - 3 * 24 * 60 * 60 * 1000;
  const rows: NewEventRow[] = [];
  let ts = start;

  const add = (by: string, payload: EventPayload) => {
    ts += 60_000;
    const event = { sv: 1, ts, at: ts, by, dev: devices[by], ...payload } as Event;
    if (parseEvent(JSON.parse(JSON.stringify(event))) === null) {
      throw new Error(`seed-c: invalid ${payload.type} event`);
    }
    const id = newId();
    rows.push({
      id,
      origin: by === sam ? 'local' : 'remote',
      acked: true,
      seq: null,
      ts,
      envelope: JSON.stringify(seal({ key: encryptionKey, groupId, body: event, id })),
      status: 'ok',
    });
  };
  const expense = (
    id: string,
    title: string,
    amount: number,
    category: Category,
    split: Record<string, number>,
  ): EventPayload => ({
    type: 'expense.added',
    expense: {
      id,
      title,
      amount,
      currency: 'CAD',
      paidBy: maya,
      date: todayIso(new Date(ts)),
      category,
      split,
    },
  });

  add(sam, { type: 'member.added', member: { id: sam, name: 'Sam' } });
  add(sam, { type: 'member.claimed', id: sam });
  add(sam, { type: 'group.created', name: 'Banff 2026', currency: 'CAD' });
  for (const [id, name] of [
    [maya, 'Maya'],
    [jordan, 'Jordan'],
    [nathan, 'Nathan'],
  ] as const) {
    add(sam, { type: 'member.added', member: { id, name } });
  }
  for (const id of [maya, jordan, nathan]) add(id, { type: 'member.claimed', id });
  add(jordan, { type: 'member.updated', id: jordan, changes: { emoji: '🏂' } });
  add(
    maya,
    expense(newId(), 'Gas at Petro-Canada', 8000, 'fuel', {
      [sam]: 2000,
      [maya]: 2000,
      [jordan]: 2000,
      [nathan]: 2000,
    }),
  );
  add(
    maya,
    expense(dinnerId, 'Dinner at Park Distillery', 9600, 'food', {
      [sam]: 3200,
      [maya]: 3200,
      [jordan]: 3200,
    }),
  );

  await secrets.setSecret(localId, secret, serverUrl);
  await store.transaction(async (tx) => {
    await tx.upsertGroup({
      localId,
      serverUrl,
      epoch: null,
      cursor: 0,
      myMemberId: sam,
      nameCache: 'Banff 2026',
      currencyCache: 'CAD',
      createdAt: start,
      lastSyncedAt: now - 2 * 60_000,
      lastSyncError: null,
      state: 'active',
      epochResetsThisCycle: 0,
    });
    await tx.insertEvents(localId, rows);
  });
  groupState.invalidate(localId);
  groupState.groupsChanged();
  return { localId, sam, maya, jordan, nathan, dinnerId };
}

export type SeedScreen =
  'expense' | 'new' | 'picker' | 'chosen' | 'error' | 'split' | 'edit' | 'settle';

export type SeedMode = 'equal' | 'exact' | 'percent';

/** Where the seed route goes: the sheet's route, and the split route pushed over it. */
export type SeedPlan =
  | { kind: 'expense'; draftId: string | null; editId: string | null; split: boolean }
  | { kind: 'settle'; from: string; to: string; amount: number };

function draftFor(b: BanffC, init: Partial<Omit<SheetDraft, 'id' | 'groupId'>>): string {
  return createDraft({
    groupId: b.localId,
    editId: null,
    title: '',
    amountText: '',
    paidBy: null,
    date: todayIso(),
    split: null,
    chip: null,
    pickerOpen: false,
    splitFocus: null,
    error: null,
    ...init,
  }).id;
}

/** The boards' drafts: the sheet's fields, the chip, and the split editor's state. */
export function planFor(b: BanffC, screen: SeedScreen, mode: SeedMode = 'exact'): SeedPlan {
  const all = [b.sam, b.maya, b.jordan, b.nathan];
  switch (screen) {
    case 'new':
      return { kind: 'expense', draftId: null, editId: null, split: false };
    case 'expense':
      // AddExpense: the keyword table puts "shuttle" in Transit.
      return {
        kind: 'expense',
        draftId: draftFor(b, { title: 'Lake Louise shuttle', amountText: '36' }),
        editId: null,
        split: false,
      };
    case 'picker':
      // CategoryPicker: the model suggested Lodging for "Grizzly House"; the picker is open.
      return {
        kind: 'expense',
        draftId: draftFor(b, {
          title: 'Grizzly House',
          amountText: '148',
          chip: { category: 'lodging', source: 'model', frozen: false, swaps: 0 },
          pickerOpen: true,
        }),
        editId: null,
        split: false,
      };
    case 'chosen':
      // CategoryChosen: you picked Food.
      return {
        kind: 'expense',
        draftId: draftFor(b, {
          title: 'Grizzly House',
          amountText: '148',
          chip: initialChipState('Grizzly House', 'food'),
        }),
        editId: null,
        split: false,
      };
    case 'error':
      // The field error state (States board) on the title, after a failed save.
      return {
        kind: 'expense',
        draftId: draftFor(b, {
          title: 'Lake Louise shuttle',
          amountText: '36',
          error: 'This group is read-only now.',
        }),
        editId: null,
        split: false,
      };
    case 'edit':
      return { kind: 'expense', draftId: null, editId: b.dinnerId, split: false };
    case 'settle':
      return { kind: 'settle', from: b.sam, to: b.maya, amount: 4400 };
    case 'split': {
      let split: SplitDraft = equalDraft(all);
      let title = 'Dinner at Park Distillery';
      let amountText = '96';
      let splitFocus: string | null = null;
      if (mode === 'equal') {
        // SplitEqual: Maya ×2 (a guest), Nathan +$12.00 (his cocktail).
        split = setExtra(setWeight(split, b.maya, 2), b.nathan, 1200);
      } else if (mode === 'exact') {
        // Split (Exact): Nathan out, Jordan's cell under the keypad at $6.00, $6.00 remaining.
        title = 'Lake Louise shuttle';
        amountText = '36';
        split = toggleMember(split, b.nathan);
        split = setAmount(setAmount(setAmount(split, b.sam, 1200), b.maya, 1200), b.jordan, 600);
        split = { ...split, mode: 'exact' };
        splitFocus = b.jordan;
      } else {
        // SplitPercent: 15 / 40 / 15 / 30, Maya's cell under the keypad.
        split = setBps(
          setBps(setBps(setBps(split, b.sam, 1500), b.maya, 4000), b.jordan, 1500),
          b.nathan,
          3000,
        );
        split = { ...split, mode: 'percent' };
        splitFocus = b.maya;
      }
      return {
        kind: 'expense',
        draftId: draftFor(b, { title, amountText, split, splitFocus }),
        editId: null,
        split: true,
      };
    }
  }
}

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const href = (value: unknown) => value as Href;

/**
 * Seeds Banff 2026 and opens `screen` as its board draws it: the Group screen first (unless `background` is false),
 * then the sheet, then Split over it. `base` is the group stack's path segment (`group`).
 */
export async function openSeed(
  services: AppServices,
  screen: SeedScreen,
  mode: SeedMode,
  { background = true, base = 'group' }: { background?: boolean; base?: string } = {},
): Promise<void> {
  const banff = await seedBanff(services);
  await services.groupState.get(banff.localId);
  const plan = planFor(banff, screen, mode);
  const root = `/${base}/${encodeURIComponent(banff.localId)}`;
  if (background) {
    router.replace(href(root));
    await wait(400);
  }
  if (plan.kind === 'settle') {
    router.push(
      href(`${root}/settle?from=${plan.from}&to=${plan.to}&amount=${String(plan.amount)}`),
    );
    return;
  }
  const query = [
    plan.draftId === null ? null : `draft=${plan.draftId}`,
    plan.editId === null ? null : `edit=${plan.editId}`,
  ].filter((q): q is string => q !== null);
  router.push(href(`${root}/expense${query.length === 0 ? '' : `?${query.join('&')}`}`));
  if (plan.split && plan.draftId !== null) {
    await wait(700);
    router.push(href(`${root}/split?draft=${plan.draftId}`));
  }
}
