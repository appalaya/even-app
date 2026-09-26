/**
 * App settings → You (AppSettings board): a `surface` card, radius 16, padding 20 16 16, gap 16: the 72 pt avatar
 * centred with the pencil badge and no caption (tapping it opens the emoji picker), then "Name" 13/18 medium
 * `textSecondary` 6 above a 44 pt field on `fill`. "Filled in when you create or join a group." follows the card.
 */
import { useEffect, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { AppText, Avatar, TextField } from '@/components';
import { EmojiPickerSheet } from '@/features/emoji/EmojiPickerSheet';
import { useApp, usePrefs } from '@/state';
import { radii, useTheme } from '@/theme';

export function YouCard({ openPicker = false }: { openPicker?: boolean }) {
  const { tokens } = useTheme();
  const { deviceId } = useApp();
  const { prefs, setName, setEmoji } = usePrefs();
  // The field shows the stored name until the user edits it here.
  const stored = prefs?.name ?? '';
  const [draft, setDraft] = useState<string | null>(null);
  const name = draft ?? stored;
  const [picking, setPicking] = useState(false);

  useEffect(() => {
    if (!openPicker) return;
    const timer = setTimeout(() => setPicking(true), 450);
    return () => clearTimeout(timer);
  }, [openPicker]);

  const save = () => {
    const clean = name.trim();
    if (clean === stored) {
      setDraft(null);
      return;
    }
    void setName(clean === '' ? null : clean)
      .catch(() => undefined)
      .finally(() => setDraft(null));
  };

  const emoji = prefs?.emoji ?? null;
  const shown = name.trim() === '' ? '?' : name;

  return (
    <View style={[styles.card, { backgroundColor: tokens.surface }]}>
      <Pressable
        onPress={() => setPicking(true)}
        accessibilityRole="button"
        accessibilityLabel={
          emoji === null
            ? `Avatar: initials ${shown}. Change avatar.`
            : `Avatar: ${emoji}. Change avatar.`
        }
        style={styles.avatar}
      >
        <Avatar
          size={72}
          name={shown}
          emoji={emoji ?? undefined}
          memberId={deviceId}
          badge="pencil"
        />
      </Pressable>
      <View style={styles.field}>
        <AppText variant="caption" weight="medium" color="textSecondary">
          Name
        </AppText>
        <TextField
          variant="inline"
          value={name}
          onChangeText={setDraft}
          onEndEditing={save}
          accessibilityLabel="Name"
          autoCapitalize="words"
          textContentType="givenName"
          returnKeyType="done"
        />
      </View>
      <EmojiPickerSheet
        visible={picking}
        onDismiss={() => setPicking(false)}
        value={emoji}
        onPick={(picked) => {
          setPicking(false);
          void setEmoji(picked);
        }}
        onUseInitials={() => {
          setPicking(false);
          void setEmoji(null);
        }}
        name={shown}
        memberId={deviceId}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    marginHorizontal: 16,
    gap: 16,
    paddingTop: 20,
    paddingHorizontal: 16,
    paddingBottom: 16,
    borderRadius: radii.group,
  },
  avatar: { alignSelf: 'center' },
  field: { gap: 6 },
});
