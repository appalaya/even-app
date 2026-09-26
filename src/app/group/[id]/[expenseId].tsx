import { useLocalSearchParams } from 'expo-router';

import { ExpenseDetailScreen } from '@/features/expense/ExpenseDetailScreen';

/** Expense detail (`/group/<localId>/<expenseId>`). */
export default function ExpenseDetailRoute() {
  const { id, expenseId } = useLocalSearchParams<{ id: string; expenseId: string }>();
  return <ExpenseDetailScreen key={`${id}/${expenseId}`} localId={id} expenseId={expenseId} />;
}
