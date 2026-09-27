/**
 * "Which name is yours?" (Join, JoinDark; Groups, create and join, extra states 4 and 5): after joining, a sheet over
 * Groups with only the close button, then, inset 20: "You've been invited to" 17/22 `textSecondary`, the group name
 * 30/36 bold (2 apart), and the server host · currency 13/18 `textMuted` with a 13 pt lock, 6 below. "Which name is
 * yours?" 20/25 semibold 28 below (10 above the list). The list is an `inset` card, radius 18, inset 16: 58 pt rows
 * with a 36 pt avatar, the name 17/22, and the "joined" mark or a chevron; separators from 62; last, "I'm not listed"
 * in the accent (medium) with the dashed add circle.
 *
 * As drawn with four rows the sheet's top edge sits 388 pt down an 874 pt screen; each further row raises it by a
 * row, up to the safe area + 48, past which the list scrolls.
 *
 * "I'm not listed" expands in place (extra states 4): its row gains an up chevron, and under it, inside the card, the
 * 56 pt avatar with its pencil badge (the avatar colour previews the one the new seat gets; a tap opens the emoji
 * picker) beside "Your name" and its field; "Filled in from your defaults in Settings." under the card; "Join as
 * Alex" at the foot. The question then sits 20 below the header and the sheet rises to 176.
 *
 * A tap on a name marked joined asks, stacked over this sheet, "Is that you on another phone, or a different Maya?"
 * (extra states 5): "It's me" claims it; "Different Maya" opens "I'm not listed" with the name empty.
 *
 * Offered again on a group this phone already holds (`again`; SeatPick, SeatPickDark): "You're already in" over the
 * group name, the question 24 below the header and 2 above "This phone doesn't know which one is you yet." (15/21
 * `textSecondary`, 10 above the list). With five rows the sheet's top edge sits at 214. A name this phone claimed
 * reads "this phone" (a 13 pt phone glyph and the caption, both `textSecondary`) in place of "joined" (SeatSameDevice).
 */
import type { MemberState } from '@even/core';
import { Fragment, type ReactNode } from 'react';
import { Pressable, ScrollView, StyleSheet, useWindowDimensions, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import {
  AddAvatar,
  AppText,
  Avatar,
  Button,
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
/** Expanded, as drawn: 874 − 176 with four rows. */
const EXPANDED_HEIGHT = 698;
/**
 * Offered again (SeatPick): 874 − 214 with five rows. SeatSameDevice draws six at 156, 58 higher; a row and its
 * separator are 59, so six rows sit at 155 here. Expanded (not drawn) it rises as Join's does, to the safe area + 48.
 */
const AGAIN_HEIGHT = 660;
const AGAIN_ROWS = 5;

export interface PickNameSheetProps {
  visible: boolean;
  onClose: () => void;
  /** Offered again on Group, to a phone that already holds the group (SeatPick): "You're already in". */
  again?: boolean;
  groupName: string;
  host: string;
  currency: string | null;
  /** Claimable members, in the group's order. */
  members: readonly MemberState[];
  /** The members this phone claimed: "this phone" in place of "joined" (SeatPick, SeatSameDevice). */
  thisPhone?: ReadonlySet<string>;
  onPick: (member: MemberState) => void;
  /** "I'm not listed" is open: the name field shows under it. */
  notListed: boolean;
  onToggleNotListed: () => void;
  newName: string;
  onChangeNewName: (name: string) => void;
  /** The new seat's avatar: its emoji, or its initials on this palette colour. */
  newEmoji: string | null;
  newColor: number;
  onChangeAvatar: () => void;
  /** The name came from App settings' defaults ("Filled in from your defaults in Settings."). */
  fromDefaults: boolean;
  onAddSelf: () => void;
  nameError?: string;
  formError?: string;
  busy: boolean;
  /** A sheet stacked over this one (the "Is that you on another phone?" question, the emoji picker). */
  children?: ReactNode;
}

export function PickNameSheet({
  visible,
  onClose,
  again = false,
  groupName,
  host,
  currency,
  members,
  thisPhone,
  onPick,
  notListed,
  onToggleNotListed,
  newName,
  onChangeNewName,
  newEmoji,
  newColor,
  onChangeAvatar,
  fromDefaults,
  onAddSelf,
  nameError,
  formError,
  busy,
  children,
}: PickNameSheetProps) {
  const { tokens } = useTheme();
  const insets = useSafeAreaInsets();
  const { height } = useWindowDimensions();
  const rows = members.length + 1;
  // The drawn height with four rows (Join; SeatPick's five less one), expanded or not; each further row adds one.
  const drawn =
    (again ? AGAIN_HEIGHT - (AGAIN_ROWS - DRAWN_ROWS) * ROW : DRAWN_HEIGHT) +
    (notListed ? EXPANDED_HEIGHT - DRAWN_HEIGHT : 0);
  const extra = Math.max(0, rows - DRAWN_ROWS) * ROW;
  const top = Math.max(insets.top + 48, height - drawn - extra);
  const shown = newName.trim();

  return (
    <Sheet
      visible={visible}
      onDismiss={onClose}
      onClose={onClose}
      top={top}
      accessibilityLabel={again ? 'Which name is yours?' : 'Join a group'}
    >
      <View style={styles.intro}>
        <AppText color="textSecondary">
          {again ? "You're already in" : "You've been invited to"}
        </AppText>
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
      <AppText
        variant="headline"
        accessibilityRole="header"
        style={[
          styles.question,
          notListed && styles.questionExpanded,
          again && styles.questionAgain,
        ]}
      >
        Which name is yours?
      </AppText>
      {again && (
        <AppText variant="subheadLoose" color="textSecondary" style={styles.again}>
          This phone doesn&apos;t know which one is you yet.
        </AppText>
      )}
      <ScrollView style={styles.flex} keyboardShouldPersistTaps="handled">
        <View style={[styles.list, { backgroundColor: tokens.surfaceInset }]}>
          {members.map((m) => {
            const mine = thisPhone?.has(m.id) === true;
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
                  trailing={
                    mine ? <ThisPhoneMark /> : joined ? <JoinedMark size={13} /> : undefined
                  }
                  chevron={!joined}
                  onPress={busy ? undefined : () => onPick(m)}
                  accessibilityLabel={
                    mine ? `${m.name}, this phone` : joined ? `${m.name}, joined` : m.name
                  }
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
            trailing={
              notListed ? <Icon name="chevronUp" size={14} color={tokens.accent} /> : undefined
            }
            onPress={busy ? undefined : onToggleNotListed}
            accessibilityHint={notListed ? 'Expanded' : undefined}
          />
          {notListed && (
            <View style={styles.newSeat}>
              <Pressable
                onPress={onChangeAvatar}
                accessibilityRole="button"
                accessibilityLabel={
                  newEmoji === null
                    ? `Your avatar, ${shown === '' ? 'initials' : shown.charAt(0)}. Change avatar.`
                    : `Your avatar, ${newEmoji}. Change avatar.`
                }
              >
                <Avatar
                  size={56}
                  name={shown === '' ? '?' : shown}
                  emoji={newEmoji ?? undefined}
                  color={newColor}
                  on="inset"
                  badge="pencil"
                  badgeRing={tokens.surfaceInset}
                />
              </Pressable>
              <View style={styles.newName}>
                <AppText variant="caption" weight="medium" color="textSecondary">
                  Your name
                </AppText>
                <TextField
                  variant="inline"
                  on="fill"
                  value={newName}
                  onChangeText={onChangeNewName}
                  accessibilityLabel="Your name"
                  autoCapitalize="words"
                  textContentType="givenName"
                  returnKeyType="join"
                  onSubmitEditing={onAddSelf}
                  error={nameError}
                />
              </View>
            </View>
          )}
        </View>
        {notListed && fromDefaults && (
          <AppText variant="caption" color="textMuted" style={styles.defaults}>
            Filled in from your defaults in Settings.
          </AppText>
        )}
        {formError !== undefined && <FieldError message={formError} style={styles.field} />}
      </ScrollView>
      {notListed && (
        <Button
          label={shown === '' ? 'Join' : `Join as ${shown}`}
          disabled={busy || shown === ''}
          onPress={onAddSelf}
          style={styles.join}
        />
      )}
      {children}
    </Sheet>
  );
}

/** "this phone" (SeatSameDevice): the 13 pt phone glyph (stroke 2.4) 4 before the 13/18 caption, in `textSecondary`. */
function ThisPhoneMark() {
  const { tokens } = useTheme();
  return (
    <View style={styles.mark}>
      <Icon name="phone" size={13} color={tokens.textSecondary} />
      <AppText variant="caption" color="textSecondary">
        this phone
      </AppText>
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  intro: { gap: 2, paddingHorizontal: 20 },
  host: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 6 },
  question: { marginTop: 28, marginBottom: 10, marginHorizontal: 20 },
  questionExpanded: { marginTop: 20 },
  questionAgain: { marginTop: 24, marginBottom: 2 },
  again: { marginBottom: 10, marginHorizontal: 20 },
  mark: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  list: { marginHorizontal: 16, borderRadius: radii.card, overflow: 'hidden' },
  newSeat: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    paddingTop: 2,
    paddingHorizontal: 14,
    paddingBottom: 16,
  },
  newName: { flex: 1, gap: 6 },
  defaults: { marginTop: 8, marginHorizontal: 20 },
  field: { marginTop: 10, marginHorizontal: 16 },
  join: { marginTop: 12, marginHorizontal: 16 },
});
