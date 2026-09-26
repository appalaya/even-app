/**
 * "Which name is yours?" (Join, JoinDark): after joining, a sheet over Groups with only the close button, then,
 * inset 20: "You've been invited to" 17/22 `textSecondary`, the group name 30/36 bold (2 apart), and the server
 * host · currency 13/18 `textMuted` with a 13 pt lock, 6 below. "Which name is yours?" 20/25 semibold 28 below
 * (10 above the list). The list is an `inset` card, radius 18, inset 16: 58 pt rows with a 36 pt avatar, the name
 * 17/22, and the "joined" mark or a chevron; separators from 62; last, "I'm not listed" in the accent (medium) with
 * the dashed add circle.
 *
 * As drawn with four rows the sheet's top edge sits 388 pt down an 874 pt screen; each further row raises it by a
 * row, up to the safe area + 48, past which the list scrolls.
 *
 * Tapping a name nobody has claimed claims it. A name marked joined asks "Is that you on another phone, or are you a
 * different Maya?" (design.md "Identity model"); "I'm not listed" opens a name field prefilled from App settings.
 * Neither follow-up is drawn on a board (see the report); both reuse drawn pieces.
 */
import type { MemberState } from '@even/core';
import { Fragment } from 'react';
import { ScrollView, StyleSheet, useWindowDimensions, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import {
  AddAvatar,
  AppText,
  Avatar,
  Icon,
  JoinedMark,
  ListRow,
  Separator,
  Sheet,
  TextField,
} from '@/components';
import { FieldError } from '@/features/groups/FieldError';
import { radii, useTheme } from '@/theme';

/** The drawn sheet: 874 − 388 tall with four rows; a row and its separator are 59. */
const DRAWN_HEIGHT = 486;
const DRAWN_ROWS = 4;
const ROW = 59;

export interface PickNameSheetProps {
  visible: boolean;
  onClose: () => void;
  groupName: string;
  host: string;
  currency: string | null;
  /** Claimable members, in the group's order. */
  members: readonly MemberState[];
  onPick: (member: MemberState) => void;
  /** "I'm not listed" is open: the name field shows under the list. */
  notListed: boolean;
  onNotListed: () => void;
  newName: string;
  onChangeNewName: (name: string) => void;
  onAddSelf: () => void;
  nameError?: string;
  formError?: string;
  busy: boolean;
}

export function PickNameSheet({
  visible,
  onClose,
  groupName,
  host,
  currency,
  members,
  onPick,
  notListed,
  onNotListed,
  newName,
  onChangeNewName,
  onAddSelf,
  nameError,
  formError,
  busy,
}: PickNameSheetProps) {
  const { tokens } = useTheme();
  const insets = useSafeAreaInsets();
  const { height } = useWindowDimensions();
  const rows = members.length + 1;
  const top = Math.max(
    insets.top + 48,
    height - DRAWN_HEIGHT - Math.max(0, rows - DRAWN_ROWS) * ROW,
  );

  return (
    <Sheet
      visible={visible}
      onDismiss={onClose}
      onClose={onClose}
      top={top}
      accessibilityLabel="Join a group"
    >
      <View style={styles.intro}>
        <AppText color="textSecondary">You&apos;ve been invited to</AppText>
        <AppText variant="title1" accessibilityRole="header">
          {groupName}
        </AppText>
        <View style={styles.host}>
          <Icon name="lock" size={13} color={tokens.textMuted} strokeWidth={2.2} />
          <AppText variant="caption" color="textMuted">
            {currency === null ? host : `${host} · ${currency}`}
          </AppText>
        </View>
      </View>
      <AppText variant="headline" accessibilityRole="header" style={styles.question}>
        Which name is yours?
      </AppText>
      <ScrollView style={styles.flex} keyboardShouldPersistTaps="handled">
        <View style={[styles.list, { backgroundColor: tokens.surfaceInset }]}>
          {members.map((m) => {
            const joined = m.devices.length > 0;
            return (
              <Fragment key={m.id}>
                <ListRow
                  variant="choice"
                  leading={
                    <Avatar
                      size={36}
                      name={m.name}
                      initials={m.initials}
                      emoji={m.emoji}
                      color={m.color}
                      on="inset"
                    />
                  }
                  title={m.name}
                  trailing={joined ? <JoinedMark size={13} /> : undefined}
                  chevron={!joined}
                  onPress={busy ? undefined : () => onPick(m)}
                  accessibilityLabel={joined ? `${m.name}, joined` : m.name}
                />
                <Separator inset={62} tone="inset" />
              </Fragment>
            );
          })}
          <ListRow
            variant="choice"
            leading={<AddAvatar />}
            title="I'm not listed"
            titleColor="accent"
            titleWeight="medium"
            onPress={busy ? undefined : onNotListed}
          />
        </View>
        {notListed && (
          <TextField
            variant="row"
            value={newName}
            onChangeText={onChangeNewName}
            placeholder="Your name"
            accessibilityLabel="Your name"
            autoCapitalize="words"
            autoFocus
            returnKeyType="join"
            onSubmitEditing={onAddSelf}
            onAdd={busy ? undefined : onAddSelf}
            error={nameError}
            containerStyle={styles.field}
          />
        )}
        {formError !== undefined && <FieldError message={formError} style={styles.field} />}
      </ScrollView>
    </Sheet>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  intro: { gap: 2, paddingHorizontal: 20 },
  host: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 6 },
  question: { marginTop: 28, marginBottom: 10, marginHorizontal: 20 },
  list: { marginHorizontal: 16, borderRadius: radii.card, overflow: 'hidden' },
  field: { marginTop: 10, marginHorizontal: 16 },
});
