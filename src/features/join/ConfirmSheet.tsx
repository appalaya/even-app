/**
 * A yes/no question in a sheet, laid out as the RegenerateInvite board draws its confirmation: no header row, the
 * question 22/28 bold 22 below the grabber, an optional 16/23 `textSecondary` paragraph 10 below it, then the
 * primary action and a neutral one 10 apart (52 pt), the whole inset 16 (text 20).
 *
 * No board draws these particular questions (the move confirmation, the keychain recovery offer, "Is that you on
 * another phone?"); they reuse this drawn pattern. Listed in the stack report.
 */
import type { ReactNode } from 'react';
import { StyleSheet, View } from 'react-native';

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
}

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
}: ConfirmSheetProps) {
  return (
    <Sheet visible={visible} onDismiss={onDismiss} accessibilityLabel={question}>
      <View style={styles.content}>
        <AppText variant="title3" accessibilityRole="header" style={styles.question}>
          {question}
        </AppText>
        {body !== undefined && (
          <AppText variant="calloutLoose" color="textSecondary" style={styles.body}>
            {body}
          </AppText>
        )}
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
  question: { marginTop: 22, marginHorizontal: 4 },
  body: { marginTop: 10, marginHorizontal: 4 },
  actions: { marginTop: 24, gap: 10 },
});
