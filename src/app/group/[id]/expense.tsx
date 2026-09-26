/**
 * Add expense (`/group/<id>/expense`) and Edit expense (`?edit=<expenseId>`), drawn as a sheet over the group.
 * `?draft=<id>` reopens an in-memory draft (the stack C dev seed prepares one). See `AddExpenseSheet`.
 */
import { Stack, useLocalSearchParams } from 'expo-router';

import { AddExpenseSheet } from '@/features/addExpense/AddExpenseSheet';
import { SHEET_ROUTE_OPTIONS } from '@/features/addExpense/RouteSheet';
import { WithServices } from '@/features/addExpense/routing';

export default function ExpenseRoute() {
  const { id, edit, draft } = useLocalSearchParams<{ id: string; edit?: string; draft?: string }>();
  return (
    <WithServices>
      <Stack.Screen options={SHEET_ROUTE_OPTIONS} />
      <AddExpenseSheet groupId={id} editId={edit ?? null} draftId={draft ?? null} />
    </WithServices>
  );
}
