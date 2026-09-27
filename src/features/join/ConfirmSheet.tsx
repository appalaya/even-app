/**
 * A yes/no question in a sheet, as the RegenerateInvite and Groups-extra-states boards draw their confirmations:
 * no header row, the question 22/28 bold 22 below the grabber, an optional 16/23 `textSecondary` paragraph 10 below
 * it, anything the question needs beside it (the recovery offer's server rows), then the primary action 20 below
 * and a neutral one 10 under it (52 pt), the whole inset 16 (text 20). Used for "Is that you on another phone, or a
 * different Maya?", "Move Banff 2026 from … to …?" and "Recover 2 groups from your keychain?".
 */
import type { ReactNode } from 'react';
import { StyleSheet, useWindowDimensions, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { AppText, Button, Sheet } from '@/components';

export interface ConfirmSheetProps {
  visible: boolean;
  onDismiss: () => void;
  question: string;
  body?: ReactNode;
  confirmLabel: string;
  onConfirm: () => void;
  cancelLabel: string;
  onCancel?: () => void;
  /** Disables both actions while the confirmed work runs. */
  busy?: boolean;
  /** Drawn between the paragraph and the actions. */
  children?: ReactNode;
  /**
   * The sheet's top edge as its board draws it on the 874 pt screen (recovery 420, move 460, "Is that you on another
   * phone?" 512): the space above the actions then flexes, as drawn. Content-sized when omitted.
   */
  drawnTop?: number;
}

/** The boards' screen height (iPhone 17 class). */
const BOARD_HEIGHT = 874;

export function ConfirmSheet({
  visible,
  onDismiss,
  question,
  body,
  confirmLabel,
  onConfirm,
  cancelLabel,
  onCancel,
  busy = false,
  children,
  drawnTop,
}: ConfirmSheetProps) {
  const insets = useSafeAreaInsets();
  const { height } = useWindowDimensions();
  const top =
    drawnTop === undefined
      ? undefined
      : Math.max(insets.top + 48, height - (BOARD_HEIGHT - drawnTop));
  return (
    <Sheet visible={visible} onDismiss={onDismiss} top={top} accessibilityLabel={question}>
      <View style={[styles.content, top !== undefined && styles.fill]}>
        <AppText variant="title3" accessibilityRole="header" style={styles.question}>
          {question}
        </AppText>
        {body !== undefined && (
          <AppText variant="calloutLoose" color="textSecondary" style={styles.body}>
            {body}
          </AppText>
        )}
        {children}
        {top !== undefined && <View style={styles.fill} />}
        <View style={styles.actions}>
          <Button label={confirmLabel} onPress={onConfirm} disabled={busy} />
          <Button
            label={cancelLabel}
            variant="neutral"
            onPress={onCancel ?? onDismiss}
            disabled={busy}
          />
        </View>
      </View>
    </Sheet>
  );
}

const styles = StyleSheet.create({
  content: { paddingHorizontal: 16 },
  fill: { flex: 1 },
  question: { marginTop: 22, marginHorizontal: 4 },
  body: { marginTop: 10, marginHorizontal: 4 },
  actions: { marginTop: 20, gap: 10 },
});
