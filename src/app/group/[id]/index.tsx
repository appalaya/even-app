import { useLocalSearchParams } from 'expo-router';

import { GroupScreen, type GroupTab } from '@/features/group/GroupScreen';

const TABS: readonly GroupTab[] = ['expenses', 'balances', 'activity'];

/**
 * Group (`/group/<localId>`). `?tab=balances|activity` opens on that tab (`&stuck=1` with the segment already under
 * the nav bar, as a tap on the tab leaves it); `?sheet=done` opens the Done adding sheet.
 */
export default function GroupRoute() {
  const { id, tab, sheet, stuck } = useLocalSearchParams<{
    id: string;
    tab?: string;
    sheet?: string;
    stuck?: string;
  }>();
  const initialTab = TABS.find((t) => t === tab);
  return (
    <GroupScreen
      key={id}
      localId={id}
      {...(initialTab === undefined ? {} : { initialTab })}
      {...(sheet === 'done' ? { initialSheet: 'done' as const } : {})}
      initialStuck={stuck === '1'}
    />
  );
}
