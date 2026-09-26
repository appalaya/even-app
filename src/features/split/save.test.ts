/**
 * The Add expense save path end to end, below the UI: the split editor's draft → `draftToSpec` → the state layer's
 * `addExpense` / `updateExpense` → the stored (resolved) split, and an edited expense reopened in the editor.
 */
import { afterEach, describe, expect, it } from 'vitest';

import { createWorld, SERVER, type World } from '@/state/testHarness';

import {
  draftFromResolved,
  draftToSpec,
  equalDraft,
  previewAmounts,
  setAmount,
  setExtra,
  setWeight,
  switchMode,
  toggleMember,
} from './draft';

let world: World | null = null;
afterEach(async () => {
  await world?.close();
  world = null;
});

async function banff() {
  world = await createWorld('fake');
  const d = await world.device();
  const { localId, memberId: sam } = await d.services.groups.createGroup({
    name: 'Banff 2026',
    currency: 'CAD',
    myName: 'Sam',
    people: ['Maya', 'Jordan', 'Nathan'],
    serverUrl: SERVER,
  });
  const state = async () => {
    const derived = await d.services.groupState.get(localId);
    if (derived?.state == null) throw new Error('no state');
    return derived.state;
  };
  const ids = [...(await state()).members.values()].map((m) => m.id);
  const [, maya, jordan, nathan] = ids as [string, string, string, string];
  return { d, localId, state, sam, maya, jordan, nathan, all: [sam, maya, jordan, nathan] };
}

describe('saving a split', () => {
  it('stores the SplitEqual board resolved: $12.00 extra first, then $84.00 by 2 : 1 : 1 : 1', async () => {
    const b = await banff();
    const draft = setExtra(setWeight(equalDraft(b.all), b.maya, 2), b.nathan, 1200);
    const result = draftToSpec(draft, 9600);
    if (!result.ok) throw new Error(result.problem);
    const id = await b.d.services.groups.addExpense(b.localId, {
      title: 'Dinner at Park Distillery',
      amount: 9600,
      paidBy: b.sam,
      date: '2026-09-20',
      category: 'food',
      split: result.spec,
    });
    const stored = (await b.state()).expenses.get(id);
    expect(stored?.split).toEqual({
      [b.sam]: 1680,
      [b.maya]: 3360,
      [b.jordan]: 1680,
      [b.nathan]: 2880,
    });
    // An uneven split's preview is exact once the expense id seeds it, as it does when editing.
    expect(previewAmounts(draft, 9600, id)).toEqual(stored?.split);
  });

  it('stores Exact amounts for the included members only', async () => {
    const b = await banff();
    let draft = switchMode(toggleMember(equalDraft(b.all), b.nathan), 'exact', 3600, 'x');
    draft = setAmount(setAmount(setAmount(draft, b.sam, 1200), b.maya, 1200), b.jordan, 1200);
    const result = draftToSpec(draft, 3600);
    if (!result.ok) throw new Error(result.problem);
    const id = await b.d.services.groups.addExpense(b.localId, {
      title: 'Lake Louise shuttle',
      amount: 3600,
      paidBy: b.sam,
      date: '2026-09-20',
      category: 'transit',
      split: result.spec,
    });
    expect((await b.state()).expenses.get(id)?.split).toEqual({
      [b.sam]: 1200,
      [b.maya]: 1200,
      [b.jordan]: 1200,
    });
  });

  it('reopens an edited expense on its split, and saving it unchanged writes nothing', async () => {
    const b = await banff();
    const first = draftToSpec(toggleMember(equalDraft(b.all), b.nathan), 10000);
    if (!first.ok) throw new Error(first.problem);
    const id = await b.d.services.groups.addExpense(b.localId, {
      title: 'Groceries',
      amount: 10000,
      paidBy: b.maya,
      date: '2026-09-20',
      category: 'groceries',
      split: first.spec,
    });
    const before = (await b.state()).expenses.get(id);
    if (before === undefined) throw new Error('no expense');
    const reopened = draftFromResolved(before.amount, before.split, b.all, id);
    expect(reopened.mode).toBe('equal');
    expect(reopened.included[b.nathan]).toBe(false);
    const again = draftToSpec(reopened, before.amount);
    if (!again.ok) throw new Error(again.problem);
    await b.d.services.groups.updateExpense(b.localId, id, {
      title: before.title,
      amount: before.amount,
      split: again.spec,
      paidBy: before.paidBy,
      date: before.date,
      category: before.category,
    });
    const after = (await b.state()).expenses.get(id);
    expect(after?.history).toHaveLength(before.history.length);
    expect(after?.split).toEqual(before.split);
  });
});
