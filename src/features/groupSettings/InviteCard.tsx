import { StyleSheet, View } from 'react-native';

import { AppText, Button, Card, Icon, ProgressRing } from '@/components';
import { layout, radii, useTheme } from '@/theme';

import { linkForDisplay } from './model';

export interface InviteCardProps {
  /** The link, or null while it is read. */
  link: string | null;
  /** Share gating: false until the group's first push is acknowledged ("Preparing your invite…"). */
  ready: boolean;
  onCopyCode: () => void;
  onShareLink: () => void;
}

/**
 * Group settings → Invite (GroupSettings board): the link in a mono box, the one-sentence warning after a key, and
 * "Copy code" (soft) beside "Share link" (primary), 44 tall. Until the invite may be shared (Group settings, extra
 * states: "Invite still preparing") the link box is a 44 pt `fill` row with the progress ring and "Preparing your
 * invite…", and both buttons are disabled.
 */
export function InviteCard({ link, ready, onCopyCode, onShareLink }: InviteCardProps) {
  const { tokens } = useTheme();
  const enabled = ready && link !== null;
  return (
    <Card radius="group" style={styles.card} accessibilityLabel="Invite">
      {ready ? (
        <View style={[styles.linkBox, { backgroundColor: tokens.fill }]}>
          <AppText
            variant="mono"
            color="textSecondary"
            numberOfLines={1}
            ellipsizeMode="tail"
            accessibilityLabel="Invite link"
          >
            {link === null ? ' ' : linkForDisplay(link)}
          </AppText>
        </View>
      ) : (
        <View
          style={[styles.preparing, { backgroundColor: tokens.fill }]}
          accessibilityRole="progressbar"
          accessibilityLiveRegion="polite"
        >
          <ProgressRing />
          <AppText variant="subheadLoose" color="textSecondary">
            Preparing your invite…
          </AppText>
        </View>
      )}
      <View style={styles.warning}>
        <View style={styles.warningIcon}>
          <Icon name="key" size={18} color={tokens.textSecondary} />
        </View>
        <AppText variant="subheadLoose" style={styles.flex}>
          Anyone with this link can see and edit the group.
        </AppText>
      </View>
      <View style={styles.buttons}>
        <Button
          label="Copy code"
          size="small"
          variant="secondary"
          disabled={!enabled}
          haptic="success"
          onPress={onCopyCode}
          style={styles.flex}
        />
        <Button
          label="Share link"
          size="small"
          disabled={!enabled}
          onPress={onShareLink}
          style={styles.flex}
        />
      </View>
    </Card>
  );
}

const styles = StyleSheet.create({
  card: { marginHorizontal: layout.gutter, padding: 16, gap: 12 },
  linkBox: { paddingVertical: 12, paddingHorizontal: 14, borderRadius: radii.control },
  preparing: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    minHeight: 44,
    paddingHorizontal: 14,
    borderRadius: radii.control,
  },
  warning: { flexDirection: 'row', alignItems: 'flex-start', gap: 10 },
  warningIcon: { paddingTop: 2 },
  buttons: { flexDirection: 'row', gap: layout.stackGap },
  flex: { flex: 1 },
});
