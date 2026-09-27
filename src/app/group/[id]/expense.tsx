/**
 * Add expense (`/group/<id>/expense`) and Edit expense (`?edit=<expenseId>`), drawn as a sheet over the group.
 * `?draft=<id>` reopens an in-memory draft (the dev seed prepares one); development builds also take `focus=title`
 * and `sheet=payer|date` for the dev seed's screenshots. See `AddExpenseSheet`.
 */
import { Stack, useLocalSearchParams } from 'expo-router';

import { AddExpenseSheet } from '@/features/addExpense/AddExpenseSheet';
import { SHEET_ROUTE_OPTIONS } from '@/features/addExpense/RouteSheet';
import { WithServices } from '@/features/addExpense/routing';

export default function ExpenseRoute() {
  const { id, edit, draft, focus, sheet } = useLocalSearchParams<{
    id: string;
    edit?: string;
    draft?: string;
    focus?: string;
    sheet?: string;
  }>();
  return (
    <WithServices>
      <Stack.Screen options={SHEET_ROUTE_OPTIONS} />
      <AddExpenseSheet
        groupId={id}
        editId={edit ?? null}
        draftId={draft ?? null}
        dev={
          __DEV__
            ? {
                focusTitle: focus === 'title',
                sheet: sheet === 'payer' || sheet === 'date' ? sheet : undefined,
              }
            : undefined
        }
      />
    </WithServices>
  );
}
