/**
 * Add member (Group settings, extra states: "Add member"): Cancel and "Add member" in the header; the 72 pt avatar
 * centred 8 below with its pencil badge, in the colour the new member will get (the id is chosen when the sheet
 * opens; a tap opens the emoji picker); "Name" and its 48 pt field (a 2 pt accent ring while typing); "They'll pick
 * this name when they join."; then "Add", 12 above the keyboard.
 */
import { memberColor, newId } from '@even/core';
import { useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { AppText, Avatar, Button, FieldLabel, Sheet, SheetHeader, TextField } from '@/components';
import { EmojiPickerSheet } from '@/features/emoji/EmojiPickerSheet';
import { useTheme } from '@/theme';

/** Between the caption (two lines) and "Add", as drawn with the keyboard up (an 18 pt spacer and Add's 16). */
const GAP_ABOVE_ADD = 34;

export interface AddMemberSheetProps {
  visible: boolean;
  error?: string;
  busy?: boolean;
  onEdit?: () => void;
  /** Development screenshots: the name to type. */
  initialName?: string;
  onAdd: (name: string, emoji: string | null, id: string) => void;
  onDismiss: () => void;
}

export function AddMemberSheet({ visible, onDismiss, ...body }: AddMemberSheetProps) {
  return (
    <Sheet visible={visible} onDismiss={onDismiss} accessibilityLabel="Add member">
      <AddMemberBody onDismiss={onDismiss} {...body} />
    </Sheet>
  );
}

function AddMemberBody({
  error,
  busy = false,
  onEdit,
  initialName = '',
  onAdd,
  onDismiss,
}: Omit<AddMemberSheetProps, 'visible'>) {
  const { tokens } = useTheme();
  const [id] = useState(() => newId());
  const [name, setName] = useState(initialName);
  const [emoji, setEmoji] = useState<string | null>(null);
  const [picking, setPicking] = useState(false);
  const clean = name.trim();
  const add = () => {
    if (clean !== '' && !busy) onAdd(clean, emoji, id);
  };
  return (
    <>
      <SheetHeader leftAction={{ label: 'Cancel', onPress: onDismiss }} navTitle="Add member" />
      <View style={styles.avatar}>
        <Pressable
          onPress={() => setPicking(true)}
          accessibilityRole="button"
          accessibilityLabel={
            emoji === null
              ? `Avatar ${clean === '' ? 'initials' : clean.charAt(0)}. Change avatar.`
              : `Avatar ${emoji}. Change avatar.`
          }
        >
          <Avatar
            size={72}
            name={clean === '' ? '?' : clean}
            emoji={emoji ?? undefined}
            color={memberColor(id)}
            badge="pencil"
            badgeRing={tokens.surface}
          />
        </Pressable>
      </View>
      <View style={styles.field}>
        <FieldLabel>Name</FieldLabel>
        <TextField
          variant="row"
          value={name}
          onChangeText={(text) => {
            setName(text);
            onEdit?.();
          }}
          accessibilityLabel="Name"
          autoFocus
          autoCapitalize="words"
          autoCorrect={false}
          returnKeyType="done"
          onSubmitEditing={add}
          editable={!busy}
          error={error}
        />
        <AppText variant="caption" color="textMuted" style={styles.helper}>
          They&apos;ll pick this name when they join.
        </AppText>
      </View>
      <Button label="Add" disabled={clean === '' || busy} onPress={add} style={styles.add} />
      <EmojiPickerSheet
        visible={picking}
        onDismiss={() => setPicking(false)}
        value={emoji}
        onPick={(picked) => {
          setEmoji(picked);
          setPicking(false);
        }}
        onUseInitials={() => {
          setEmoji(null);
          setPicking(false);
        }}
        name={clean === '' ? '?' : clean}
        color={memberColor(id)}
      />
    </>
  );
}

const styles = StyleSheet.create({
  avatar: { alignItems: 'center', marginTop: 8 },
  field: { gap: 6, marginTop: 16, marginHorizontal: 16 },
  helper: { paddingHorizontal: 4 },
  add: { marginTop: GAP_ABOVE_ADD, marginHorizontal: 16 },
});
