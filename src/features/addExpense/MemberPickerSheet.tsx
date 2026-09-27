/**
 * The member picker (Add expense, extra states: "Paid by picker"; Settle, extra states: "To picker"): a small sheet
 * with only its centred title ("Paid by", "From", "To"), then one 56 pt row per member, padded 20: the 32 pt
 * avatar, the name 17/22 (semibold when chosen) and a 20 pt accent check on the chosen one; separators from 64.
 * Tapping a name picks it and closes the sheet. Settle lists everyone except whoever is on the other side.
 */
import type { MemberState } from '@even/core';
import { Fragment } from 'react';
import { Pressable, ScrollView, StyleSheet, useWindowDimensions, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { AppText, Avatar, Icon, Separator, Sheet } from '@/components';
import { useTheme } from '@/theme';

import { memberLabel } from './labels';

/** Row and separator heights, and the header above them (grabber 11 + header 48), as drawn. */
const ROW = 56;
const HEADER = 59;
/** The boards leave 14 under the last row above the home-indicator padding (Paid by: top 540 with four rows). */
const TAIL = 14;

export interface MemberPickerSheetProps {
  visible: boolean;
  /** "Paid by", "From", "To". */
  title: string;
  members: readonly MemberState[];
  meId: string | null;
  /** The current choice, drawn with the check. */
  value: string | null;
  onPick: (memberId: string) => void;
  onDismiss: () => void;
}

export function MemberPickerSheet({
  visible,
  title,
  members,
  meId,
  value,
  onPick,
  onDismiss,
}: MemberPickerSheetProps) {
  const { tokens } = useTheme();
  const insets = useSafeAreaInsets();
  const { height } = useWindowDimensions();
  const maxList = Math.max(ROW * 3, height - insets.top - 48 - HEADER - TAIL - 34);
  return (
    <Sheet visible={visible} onDismiss={onDismiss} navTitle={title} accessibilityLabel={title}>
      <ScrollView
        style={{ maxHeight: maxList }}
        bounces={false}
        accessibilityRole="radiogroup"
        accessibilityLabel={title}
      >
        {members.map((m, i) => {
          const chosen = m.id === value;
          const label = memberLabel(m, meId);
          return (
            <Fragment key={m.id}>
              {i > 0 && <Separator inset={64} />}
              <Pressable
                onPress={() => onPick(m.id)}
                accessibilityRole="radio"
                accessibilityLabel={label}
                accessibilityState={{ checked: chosen }}
                style={({ pressed }) => [
                  styles.row,
                  pressed && { backgroundColor: tokens.rowPressed },
                ]}
              >
                <Avatar
                  size={32}
                  name={m.name}
                  initials={m.initials}
                  emoji={m.emoji}
                  color={m.color}
                />
                <AppText weight={chosen ? 'semibold' : 'regular'} style={styles.name}>
                  {label}
                </AppText>
                {chosen && <Icon name="check" size={20} color={tokens.accent} />}
              </Pressable>
            </Fragment>
          );
        })}
      </ScrollView>
      <View style={styles.tail} />
    </Sheet>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    minHeight: ROW,
    paddingHorizontal: 20,
  },
  name: { flex: 1 },
  tail: { height: TAIL },
});
