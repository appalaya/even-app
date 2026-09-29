import { useEffect } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import Animated, {
  cancelAnimation,
  Easing,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withRepeat,
  withTiming,
} from 'react-native-reanimated';

import { strokes, useTheme } from '@/theme';

import { AppText } from './AppText';
import { Icon } from './Icon';

/**
 * - `synced` (Group): a 6 pt accent dot, "Synced 2 min ago", the sync glyph in `iconMuted` (tap to sync now).
 * - `syncing` (Group, syncing): accent dot, "Syncing…", the glyph in the accent turning once per 1.1 s (held at 40°
 *   under Reduce Motion), not tappable.
 * - `stale` (States): a 7 pt hollow dot (1.5 pt `iconMuted` ring), "Not synced since 2:10 pm" (`notSyncedLabel`),
 *   the sync glyph in `iconMuted`.
 */
export type SyncState = 'synced' | 'syncing' | 'stale';

export interface StatusLineProps {
  state: SyncState;
  /** The line as the screen words it ("Synced 2 min ago", "Syncing…", "Not synced since 9:41"). */
  label: string;
  /** Manual sync (debounced by the caller). */
  onSyncNow?: () => void;
  /** The sync button at the trailing edge (default). GroupNoSeat draws the line without it. */
  button?: boolean;
}

export { notSyncedLabel } from './statusLineWords';

/**
 * The sync line under Group's big number: 6 pt dot, 6 pt gap, 13/18 `textMuted`, and a 44 pt sync button at the
 * trailing edge whose 16 pt glyph sits inside the 18 pt line (negative margins keep the line 18 tall).
 */
export function StatusLine({ state, label, onSyncNow, button = true }: StatusLineProps) {
  const { tokens } = useTheme();
  const syncing = state === 'syncing';
  return (
    <View
      style={styles.row}
      accessibilityRole={syncing ? 'progressbar' : undefined}
      accessibilityLiveRegion="polite"
    >
      <View
        style={
          state === 'stale'
            ? [styles.hollowDot, { borderColor: tokens.iconMuted }]
            : [styles.dot, { backgroundColor: tokens.accent }]
        }
      />
      <AppText variant="caption" color="textMuted" style={styles.label}>
        {label}
      </AppText>
      {button && (
        <Pressable
          onPress={onSyncNow}
          disabled={syncing}
          accessibilityRole="button"
          accessibilityLabel={syncing ? 'Syncing' : 'Sync now'}
          accessibilityState={{ disabled: syncing, busy: syncing }}
          style={styles.button}
        >
          <SyncGlyph spinning={syncing} color={syncing ? tokens.accent : tokens.iconMuted} />
        </Pressable>
      )}
    </View>
  );
}

/** The 16 pt sync glyph; turns (1.1 s per turn, linear, from 40°) while `spinning`, unless Reduce Motion is on. */
export function SyncGlyph({ spinning, color }: { spinning: boolean; color: string }) {
  const reduceMotion = useReducedMotion();
  const turn = useSharedValue(0);
  useEffect(() => {
    if (spinning && !reduceMotion) {
      turn.set(0);
      turn.set(withRepeat(withTiming(1, { duration: 1100, easing: Easing.linear }), -1, false));
    } else {
      cancelAnimation(turn);
      turn.set(0);
    }
  }, [spinning, reduceMotion, turn]);
  const style = useAnimatedStyle(() => ({
    transform: [{ rotate: `${(spinning ? 40 : 0) + turn.get() * 360}deg` }],
  }));
  return (
    <Animated.View style={style}>
      <Icon name="sync" size={16} color={color} />
    </Animated.View>
  );
}

/**
 * The 7 pt dot beside a group's name on Groups: filled accent when synced, a 1.5 pt `iconMuted` ring when waiting.
 */
export function SyncDot({ waiting = false }: { waiting?: boolean }) {
  const { tokens } = useTheme();
  return (
    <View
      accessibilityLabel={waiting ? 'Waiting to sync' : 'Synced'}
      style={[
        styles.groupDot,
        waiting
          ? { borderWidth: strokes.dashed, borderColor: tokens.iconMuted }
          : { backgroundColor: tokens.accent },
      ]}
    />
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  dot: { width: 6, height: 6, borderRadius: 3, flexShrink: 0 },
  hollowDot: {
    width: 7,
    height: 7,
    borderRadius: 4,
    borderWidth: strokes.dashed,
    flexShrink: 0,
  },
  label: { flexShrink: 1 },
  button: {
    width: 44,
    height: 44,
    marginTop: -13,
    marginBottom: -13,
    marginRight: -14,
    marginLeft: 'auto',
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
  },
  groupDot: { width: 7, height: 7, borderRadius: 4, flexShrink: 0 },
});
