/**
 * Split (`/group/<id>/split?draft=<id>`), pushed from Add expense: it slides in over the sheet and hands the split
 * back to the sheet's in-memory draft on Done. See `SplitSheet`.
 */
import { Stack, useLocalSearchParams } from 'expo-router';

import { SHEET_ROUTE_OPTIONS } from '@/features/addExpense/RouteSheet';
import { WithServices } from '@/features/addExpense/routing';
import { SplitSheet } from '@/features/split/SplitSheet';

export default function SplitRoute() {
  const { id, draft } = useLocalSearchParams<{ id: string; draft?: string }>();
  return (
    <WithServices>
      <Stack.Screen options={SHEET_ROUTE_OPTIONS} />
      <SplitSheet groupId={id} draftId={draft ?? null} />
    </WithServices>
  );
}
