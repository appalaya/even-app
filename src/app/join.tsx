/**
 * Join, presented as sheets over Groups: "Join with code" (JoinCode boards), then "Which name is yours?" (Join
 * boards). Parameters: `code` (an invite code or link, from `/i` or a paste elsewhere) prefills the field;
 * `localId` opens straight at the name pick for a group this phone holds without a claimed seat (a join that had to
 * wait for its first sync). `even://join` lands here empty.
 */
import { useLocalSearchParams } from 'expo-router';

import { useRouteSheet } from '@/features/groups/useRouteSheet';
import { JoinFlow } from '@/features/join/JoinFlow';

export default function JoinRoute() {
  const { code, localId } = useLocalSearchParams<{ code?: string; localId?: string }>();
  const { visible, close, leaveTo } = useRouteSheet();
  return (
    <JoinFlow
      visible={visible}
      initialCode={code}
      pickLocalId={localId}
      onClose={close}
      onDone={leaveTo}
    />
  );
}
