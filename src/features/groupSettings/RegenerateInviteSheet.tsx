import type { MemberState } from '@even/core';
import { useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { AppText, Button, MemberChip, Sheet } from '@/components';

export interface RegenerateInviteSheetProps {
  visible: boolean;
  /** Everyone "Remove someone?" offers (not you, not archived). */
  members: readonly MemberState[];
  /** The rotation is running: both buttons wait. */
  busy: boolean;
  /** Development screenshots: the member drawn selected when the sheet opens. */
  initialRemoveId?: string;
  onRegenerate: (removeMemberId: string | undefined) => void;
  onDismiss: () => void;
}

/** The sheet's top edge on the RegenerateInvite board (402 × 874). */
const SHEET_TOP = 356;

/**
 * "Regenerate the invite link?" (RegenerateInvite board): the question, what it means for everyone, an optional
 * single choice of someone to remove (archived in the new group), then Regenerate and Cancel.
 */
export function RegenerateInviteSheet({
  visible,
  onDismiss,
  busy,
  ...body
}: RegenerateInviteSheetProps) {
  const dismiss = () => {
    if (!busy) onDismiss();
  };
  return (
    <Sheet
      visible={visible}
      onDismiss={dismiss}
      top={SHEET_TOP}
      accessibilityLabel="Regenerate the invite link?"
    >
      {/* Mounts on each open: nobody is picked until the user picks. */}
      <RegenerateBody busy={busy} onDismiss={dismiss} {...body} />
    </Sheet>
  );
}

function RegenerateBody({
  members,
  busy,
  initialRemoveId,
  onRegenerate,
  onDismiss,
}: Omit<RegenerateInviteSheetProps, 'visible'>) {
  const [removeId, setRemoveId] = useState<string | null>(initialRemoveId ?? null);
  const removed = members.find((m) => m.id === removeId) ?? null;
  return (
    <View style={styles.body}>
      <AppText variant="title3" accessibilityRole="header" style={styles.title}>
        Regenerate the invite link?
      </AppText>
      <AppText variant="calloutLoose" color="textSecondary" style={styles.paragraph}>
        The old link stops working. You&apos;ll share the new one next.
      </AppText>
      {members.length > 0 && (
        <>
          <AppText variant="caption" weight="semibold" color="textSecondary" style={styles.label}>
            Remove someone? (optional)
          </AppText>
          <View style={styles.chips} accessibilityLabel="Remove someone">
            {members.map((m) => (
              <MemberChip
                key={m.id}
                name={m.name}
                initials={m.initials}
                emoji={m.emoji}
                color={m.color}
                selected={m.id === removeId}
                onToggle={() => setRemoveId((current) => (current === m.id ? null : m.id))}
              />
            ))}
          </View>
          {removed !== null && (
            <AppText variant="caption" color="textSecondary" style={styles.caption}>
              {removed.name} won&apos;t be in the new group, but stays in past expenses.
            </AppText>
          )}
        </>
      )}
      <View style={styles.spacer} />
      <Button
        label="Regenerate"
        disabled={busy}
        onPress={() => onRegenerate(removeId ?? undefined)}
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
  body: { flex: 1, paddingHorizontal: 16 },
  title: { marginTop: 22, marginHorizontal: 4 },
  paragraph: { marginTop: 10, marginHorizontal: 4 },
  label: { marginTop: 20, marginHorizontal: 4, marginBottom: 8 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  caption: { marginTop: 8, marginHorizontal: 4 },
  spacer: { flex: 1 },
  cancel: { marginTop: 10 },
});
