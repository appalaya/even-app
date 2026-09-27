/**
 * Record a payment (`/group/<id>/settle?from=<memberId>&to=<memberId>&amount=<minor units>`), drawn as a sheet over
 * the group and prefilled from the tapped settle-list row. Development builds also take `sheet=to|from|date` and
 * `recorded=1` (the dev seed's screenshots). See `SettleSheet`.
 */
import { Stack, useLocalSearchParams } from 'expo-router';

import { SHEET_ROUTE_OPTIONS } from '@/features/addExpense/RouteSheet';
import { leaveSheet, WithServices } from '@/features/addExpense/routing';
import { SettleSheet } from '@/features/settle/SettleSheet';

export default function SettleRoute() {
  const { id, from, to, amount, sheet, recorded } = useLocalSearchParams<{
    id: string;
    from?: string;
    to?: string;
    amount?: string;
    sheet?: string;
    recorded?: string;
  }>();
  return (
    <WithServices>
      <Stack.Screen options={SHEET_ROUTE_OPTIONS} />
      <SettleSheet
        groupId={id}
        params={{ from, to, amount }}
        onClosed={() => leaveSheet(id)}
        dev={
          __DEV__
            ? {
                sheet: sheet === 'to' || sheet === 'from' || sheet === 'date' ? sheet : undefined,
                recorded: recorded === '1',
              }
            : undefined
        }
      />
    </WithServices>
  );
}
