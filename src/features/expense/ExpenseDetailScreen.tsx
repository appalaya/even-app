import { router } from 'expo-router';
import { Alert } from 'react-native';

import { Screen } from '@/components';
import { useApp, useGroup } from '@/state';

import { useLeaveWhenGone, useNow } from '../group/hooks';
import { groupHrefs } from '../group/routes';
import { ExpenseDetailView } from './ExpenseDetailView';
import { editableCurrency, flagOf } from './model';

/** Expense detail for `/group/<localId>/<expenseId>`, over the group's derived state. */
export function ExpenseDetailScreen({
  localId,
  expenseId,
}: {
  localId: string;
  expenseId: string;
}) {
  const { groups } = useApp();
  const { status, derived } = useGroup(localId);
  const now = useNow();
  const state = derived?.state ?? null;
  const live = state?.expenses.get(expenseId);
  const expense = live ?? state?.deletedExpenses.get(expenseId);

  const back = () =>
    router.canGoBack() ? router.back() : router.replace(groupHrefs.group(localId));

  useLeaveWhenGone(status);

  if (derived === null || state === null || expense === undefined) {
    return <Screen back={{ label: derived?.name ?? '', onPress: back }}>{null}</Screen>;
  }

  // "Couldn't save. Try again." is how Add expense words a failed write; these say which write failed.
  const deleteFailed = () => Alert.alert("Couldn't delete. Try again.");
  const restoreFailed = () => Alert.alert("Couldn't restore. Try again.");

  return (
    <ExpenseDetailView
      groupName={derived.name}
      state={state}
      expense={expense}
      myId={derived.myMemberId}
      writable={
        live !== undefined &&
        derived.readOnly === null &&
        !derived.needsClaim &&
        editableCurrency(expense.currency, derived.currency)
      }
      flag={flagOf(state, expenseId)}
      now={now}
      onBack={back}
      onEdit={() => router.push(groupHrefs.editExpense(localId, expenseId))}
      onDelete={() =>
        Alert.alert('Delete this expense?', undefined, [
          { text: 'Cancel', style: 'cancel' },
          {
            text: 'Delete',
            style: 'destructive',
            onPress: () => {
              groups.deleteExpense(localId, expenseId).then(back, deleteFailed);
            },
          },
        ])
      }
      onRestore={(index) => {
        groups.restoreExpenseVersion(localId, expenseId, index).catch(restoreFailed);
      }}
    />
  );
}
