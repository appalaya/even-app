import { useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { AppText, Button, Card, Sheet, ToggleRow } from '@/components';

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
 * Leave (design.md "Rotation, moving, closing"): local only; says how many of this phone's changes never reached
 * the server; offers "Also delete this group's copy on <host>" with its warning. Laid out as the RegenerateInvite
 * board's confirmation (question, paragraph, then the primary action over Cancel); no board draws Leave itself.
 */
export function LeaveSheet({ visible, onDismiss, busy, groupName, ...body }: LeaveSheetProps) {
  const dismiss = () => {
    if (!busy) onDismiss();
  };
  return (
    <Sheet visible={visible} onDismiss={dismiss} accessibilityLabel={`Leave ${groupName}?`}>
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
  const [deleteCopy, setDeleteCopy] = useState(false);
  return (
    <View style={styles.body}>
      <AppText variant="title3" accessibilityRole="header" style={styles.title}>
        Leave {groupName}?
      </AppText>
      <AppText variant="calloutLoose" color="textSecondary" style={styles.paragraph}>
        Removes {groupName} from this phone. The others keep it.
        {unsent > 0 &&
          ` ${unsent} ${unsent === 1 ? 'change' : 'changes'} from this phone never reached the server; the others will never see ${unsent === 1 ? 'it' : 'them'}.`}
      </AppText>
      <Card tone="fill" radius="group" style={styles.toggle}>
        <ToggleRow
          label={`Also delete this group's copy on ${host}`}
          value={deleteCopy}
          onValueChange={setDeleteCopy}
          disabled={busy}
        />
      </Card>
      {deleteCopy && (
        <AppText variant="caption" color="textSecondary" style={styles.caption}>
          Other members will recreate it on their next sync unless they leave too.
        </AppText>
      )}
      <Button
        label="Leave"
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
  body: { paddingHorizontal: 16 },
  title: { marginTop: 22, marginHorizontal: 4 },
  paragraph: { marginTop: 10, marginHorizontal: 4 },
  toggle: { marginTop: 20 },
  caption: { marginTop: 8, marginHorizontal: 4 },
  leave: { marginTop: 24 },
  cancel: { marginTop: 10 },
});
