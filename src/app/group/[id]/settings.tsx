import { useLocalSearchParams } from 'expo-router';
import { useMemo } from 'react';

import {
  GroupSettingsScreen,
  type GroupSettingsDev,
} from '@/features/groupSettings/GroupSettingsScreen';

type Params = {
  id: string;
  /** Development builds only, for screenshots (src/app/dev/seed-d.tsx): `y`, `open`, `member`, `value`. */
  y?: string;
  open?: GroupSettingsDev['open'];
  member?: string;
  value?: string;
};

/** Group settings: invite, members, server, exports, regenerate the invite, archive, leave. */
export default function GroupSettingsRoute() {
  const { id, y, open, member, value } = useLocalSearchParams<Params>();
  const dev = useMemo<GroupSettingsDev | undefined>(() => {
    if (!__DEV__) return undefined;
    const scrollY = y === undefined ? undefined : Number(y);
    return {
      scrollY: scrollY !== undefined && Number.isFinite(scrollY) ? scrollY : undefined,
      open,
      member,
      value,
    };
  }, [y, open, member, value]);
  return <GroupSettingsScreen localId={id} dev={dev} />;
}
