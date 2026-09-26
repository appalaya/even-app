import { Clipboard, Share, StyleSheet, View } from 'react-native';
import Animated, {
  cancelAnimation,
  Easing,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withRepeat,
  withTiming,
} from 'react-native-reanimated';
import Svg, { Circle, Path } from 'react-native-svg';
import { useEffect } from 'react';

import { AppText, AvatarStack, Button, Card, type StackMember } from '@/components';
import { layout, useTheme } from '@/theme';
import type { InviteInfo } from '@/state';

/** The share sheet's title for a group's invite (Share sheet board: "Even · Join Banff 2026"). */
export function inviteShareTitle(groupName: string): string {
  return `Even · Join ${groupName}`;
}

/** Hands the invite link to the OS share sheet. */
export function shareInvite(invite: InviteInfo, groupName: string): void {
  const title = inviteShareTitle(groupName);
  void Share.share({ url: invite.link, title }, { subject: title }).catch(() => undefined);
}

/**
 * Group, just created: "Invite your group", the one-sentence warning, and "Share link" · "Copy code" (48 pt, 10
 * apart). Until the server has acknowledged the group (`InviteInfo.ready`) the sentence becomes a spinning ring and
 * "Preparing your invite…" and both buttons are disabled (Invite card, preparing).
 */
export function InviteCard({
  invite,
  groupName,
}: {
  invite: InviteInfo | null;
  groupName: string;
}) {
  const ready = invite?.ready === true;
  return (
    <Card style={styles.card} accessibilityLabel="Invite your group">
      <AppText variant="headline" accessibilityRole="header">
        Invite your group
      </AppText>
      {ready ? (
        <AppText variant="subheadLoose" color="textSecondary">
          Anyone with the link can see and edit this group.
        </AppText>
      ) : (
        <View
          style={styles.preparing}
          accessibilityRole="progressbar"
          accessibilityLiveRegion="polite"
        >
          <ProgressRing />
          <AppText variant="subheadLoose" color="textSecondary">
            Preparing your invite…
          </AppText>
        </View>
      )}
      <View style={styles.buttons}>
        <Button
          label="Share link"
          size="medium"
          disabled={!ready}
          style={styles.half}
          onPress={() => {
            if (invite !== null) shareInvite(invite, groupName);
          }}
        />
        <Button
          label="Copy code"
          size="medium"
          variant="secondary"
          disabled={!ready}
          haptic="success"
          style={styles.half}
          onPress={() => {
            if (invite !== null) Clipboard.setString(invite.code);
          }}
        />
      </View>
    </Card>
  );
}

/**
 * The 16 pt ring beside "Preparing your invite…": an `outline` track and an accent quarter arc (stroke 2.6), turning
 * once a second; still under Reduce Motion.
 */
function ProgressRing() {
  const { tokens } = useTheme();
  const reduceMotion = useReducedMotion();
  const turn = useSharedValue(0);
  useEffect(() => {
    if (reduceMotion) {
      cancelAnimation(turn);
      turn.set(0);
      return;
    }
    turn.set(withRepeat(withTiming(1, { duration: 1000, easing: Easing.linear }), -1, false));
    return () => cancelAnimation(turn);
  }, [reduceMotion, turn]);
  const style = useAnimatedStyle(() => ({ transform: [{ rotate: `${turn.get() * 360}deg` }] }));
  return (
    <Animated.View style={style}>
      <Svg width={16} height={16} viewBox="0 0 24 24" fill="none">
        <Circle cx={12} cy={12} r={9} stroke={tokens.outline} strokeWidth={2.6} />
        <Path
          d="M12 3a9 9 0 0 1 9 9"
          stroke={tokens.accent}
          strokeWidth={2.6}
          strokeLinecap="round"
        />
      </Svg>
    </Animated.View>
  );
}

/** "4 people · nobody else has joined yet" under the invite card, with the 24 pt stack on the canvas colour. */
export function PeopleRow({ members }: { members: StackMember[] }) {
  const { tokens } = useTheme();
  const count = members.length;
  return (
    <View style={styles.people}>
      <AvatarStack members={members} size={24} ringColor={tokens.background} />
      <AppText variant="caption" color="textMuted" style={styles.flex}>
        {`${count} ${count === 1 ? 'person' : 'people'} · nobody else has joined yet`}
      </AppText>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    marginTop: 8,
    marginHorizontal: layout.gutter,
    gap: 10,
    paddingTop: 18,
    paddingHorizontal: 16,
    paddingBottom: 16,
  },
  preparing: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  buttons: { flexDirection: 'row', gap: layout.stackGap, marginTop: 4 },
  half: { flex: 1, flexBasis: 0 },
  people: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    marginTop: 16,
    marginHorizontal: layout.textInset,
  },
  flex: { flex: 1 },
});
