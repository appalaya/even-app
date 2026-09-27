import { useState } from 'react';
import { StyleSheet, useWindowDimensions, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { AppText, Button, Checkbox, Icon, Sheet } from '@/components';
import { radii, useTheme } from '@/theme';

export interface LeaveSheetProps {
  visible: boolean;
  groupName: string;
  /** The server this group syncs through ("sync.even.appalaya.com"). */
  host: string;
  /** This phone's changes no server has acknowledged. */
  unsent: number;
  busy: boolean;
  onLeave: (deleteServerCopy: boolean) => void;
  onDismiss: () => void;
}

/**
 * Leave (Group settings, extra states: "Leave, with unsent entries"; design.md "Rotation, moving, closing"): local
 * only. "Leave Banff 2026?", "Removes the group from this phone. The others keep it."; with unsent entries a `fill`
 * box saying how many nobody else has seen; the "Also delete this group's copy on <host>" checkbox with its warning;
 * then "Leave anyway" (or "Leave" without unsent entries) in `danger` on `fill`, and Cancel.
 */
/** The sheet's top edge on the 874 pt board (Group settings, extra states: Leave). */
const DRAWN_TOP = 300;
const BOARD_HEIGHT = 874;

export function LeaveSheet({ visible, onDismiss, busy, groupName, ...body }: LeaveSheetProps) {
  const insets = useSafeAreaInsets();
  const { height } = useWindowDimensions();
  const dismiss = () => {
    if (!busy) onDismiss();
  };
  return (
    <Sheet
      visible={visible}
      onDismiss={dismiss}
      top={Math.max(insets.top + 48, height - (BOARD_HEIGHT - DRAWN_TOP))}
      accessibilityLabel={`Leave ${groupName}?`}
    >
      <LeaveBody groupName={groupName} busy={busy} onDismiss={dismiss} {...body} />
    </Sheet>
  );
}

function LeaveBody({
  groupName,
  host,
  unsent,
  busy,
  onLeave,
  onDismiss,
}: Omit<LeaveSheetProps, 'visible'>) {
  const { tokens } = useTheme();
  // Drawn checked (Group settings, extra states).
  const [deleteCopy, setDeleteCopy] = useState(true);
  const label = `Also delete this group's copy on ${host}`;
  return (
    <View style={styles.body}>
      <AppText variant="title3" accessibilityRole="header" style={styles.title}>
        Leave {groupName}?
      </AppText>
      <AppText variant="calloutLoose" color="textSecondary" style={styles.paragraph}>
        Removes the group from this phone. The others keep it.
      </AppText>
      {unsent > 0 && (
        <View style={[styles.unsent, { backgroundColor: tokens.fill }]} accessibilityRole="alert">
          <View style={styles.icon}>
            <Icon name="warning" size={16} color={tokens.text} strokeWidth={2.2} />
          </View>
          <AppText variant="subheadLoose" weight="semibold" style={styles.flex}>
            {`You have ${unsent} ${unsent === 1 ? 'entry' : 'entries'} nobody else has seen yet. Leave anyway?`}
          </AppText>
        </View>
      )}
      <View style={styles.option}>
        <Checkbox
          checked={deleteCopy}
          onToggle={() => setDeleteCopy((on) => !on)}
          label={label}
          disabled={busy}
        />
        <View style={styles.optionText} importantForAccessibility="no-hide-descendants">
          <AppText
            variant="callout"
            style={styles.optionLabel}
            onPress={() => setDeleteCopy((on) => !on)}
          >
            {label}
          </AppText>
          <AppText variant="footnote" color="textSecondary">
            Other members will put it back on their next sync unless they leave too.
          </AppText>
        </View>
      </View>
      <View style={styles.flex} />
      <Button
        label={unsent > 0 ? 'Leave anyway' : 'Leave'}
        variant="danger"
        disabled={busy}
        onPress={() => onLeave(deleteCopy)}
        style={styles.leave}
      />
      <Button
        label="Cancel"
        variant="neutral"
        disabled={busy}
        onPress={onDismiss}
        style={styles.cancel}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  body: { flex: 1, paddingHorizontal: 16 },
  title: { marginTop: 22, marginHorizontal: 4 },
  paragraph: { marginTop: 10, marginHorizontal: 4 },
  unsent: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 8,
    marginTop: 16,
    paddingVertical: 12,
    paddingHorizontal: 14,
    borderRadius: radii.tile,
  },
  icon: { paddingTop: 2 },
  option: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 12,
    marginTop: 16,
    marginHorizontal: 4,
  },
  optionText: { flex: 1, gap: 4 },
  /** 16/22, as drawn. */
  optionLabel: { lineHeight: 22 },
  leave: { marginTop: 20 },
  cancel: { marginTop: 10 },
});
