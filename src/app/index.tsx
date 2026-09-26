import { router } from 'expo-router';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { useTheme } from '@/theme';

/** Groups screen, placeholder: wordmark, tagline, and the two actions (not wired yet). */
export default function GroupsScreen() {
  const { tokens } = useTheme();
  return (
    <SafeAreaView style={[styles.screen, { backgroundColor: tokens.background }]}>
      <View style={styles.hero}>
        <Text
          accessibilityRole="header"
          // Dev only: long-press opens the UI kit gallery (src/app/dev/kit.tsx).
          onLongPress={__DEV__ ? () => router.push('/dev/kit') : undefined}
          style={[styles.wordmark, { color: tokens.accent }]}
        >
          Even
        </Text>
        <Text style={[styles.tagline, { color: tokens.textMuted }]}>Pay whoever. End even.</Text>
      </View>
      <View style={styles.actions}>
        <PlaceholderButton label="Create group" variant="primary" />
        <PlaceholderButton label="Join with code" variant="secondary" />
      </View>
    </SafeAreaView>
  );
}

function PlaceholderButton({
  label,
  variant,
}: {
  label: string;
  variant: 'primary' | 'secondary';
}) {
  const { tokens } = useTheme();
  const primary = variant === 'primary';
  return (
    <Pressable
      disabled
      accessibilityRole="button"
      accessibilityState={{ disabled: true }}
      style={[
        styles.button,
        primary
          ? { backgroundColor: tokens.accent }
          : { backgroundColor: tokens.surface, borderColor: tokens.border, borderWidth: 1 },
      ]}
    >
      <Text style={[styles.buttonLabel, { color: primary ? tokens.onAccent : tokens.text }]}>
        {label}
      </Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    paddingHorizontal: 24,
    paddingBottom: 16,
  },
  hero: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
  },
  wordmark: {
    fontSize: 56,
    fontWeight: '700',
    letterSpacing: -1.5,
  },
  tagline: {
    fontSize: 17,
  },
  actions: {
    gap: 12,
  },
  button: {
    minHeight: 52,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 20,
    opacity: 0.5,
  },
  buttonLabel: {
    fontSize: 17,
    fontWeight: '600',
  },
});
