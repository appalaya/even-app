/**
 * Record a payment (`/group/<id>/settle?from=<memberId>&to=<memberId>&amount=<minor units>`), drawn as a sheet over
 * the group and prefilled from the tapped settle-list row. See `SettleSheet`.
 */
import { Stack, useLocalSearchParams } from 'expo-router';

import { SHEET_ROUTE_OPTIONS } from '@/features/addExpense/RouteSheet';
import { leaveSheet, WithServices } from '@/features/addExpense/routing';
import { SettleSheet } from '@/features/settle/SettleSheet';

export default function SettleRoute() {
  const { id, from, to, amount } = useLocalSearchParams<{
    id: string;
    from?: string;
    to?: string;
    amount?: string;
  }>();
  return (
    <WithServices>
      <Stack.Screen options={SHEET_ROUTE_OPTIONS} />
      <SettleSheet groupId={id} params={{ from, to, amount }} onClosed={() => leaveSheet(id)} />
    </WithServices>
  );
}
