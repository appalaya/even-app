/**
 * Groups with no groups yet (GroupsEmpty board): the mark and its circles centred in the space between the header
 * and the actions, "Create group" (primary) over "Join with code" (secondary) 10 apart and inset 16, and "Pay
 * whoever. End even." 13/18 `textMuted`, centred, 24 below them and 34 above the home indicator's edge.
 */
import { StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { AppText, Button } from '@/components';
import { layout } from '@/theme';

import { EmptyMotion } from './EmptyMotion';

export function GroupsEmpty({
  onCreate,
  onJoin,
  motionAt,
}: {
  onCreate: () => void;
  onJoin: () => void;
  /** Dev screenshots: hold the motion at this time (ms). */
  motionAt?: number;
}) {
  const insets = useSafeAreaInsets();
  return (
    <View style={styles.fill}>
      <View style={styles.art}>
        <EmptyMotion at={motionAt} />
      </View>
      <View style={styles.actions}>
        <Button label="Create group" onPress={onCreate} />
        <Button label="Join with code" variant="secondary" onPress={onJoin} />
      </View>
      <AppText
        variant="caption"
        color="textMuted"
        align="center"
        style={[styles.tagline, { paddingBottom: Math.max(insets.bottom, layout.homeIndicator) }]}
      >
        Pay whoever. End even.
      </AppText>
    </View>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  art: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 16 },
  actions: { gap: 10, paddingHorizontal: 16 },
  tagline: { paddingTop: 24, paddingHorizontal: 16 },
});
