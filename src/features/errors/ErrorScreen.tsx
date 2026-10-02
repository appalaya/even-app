/**
 * One full-screen message, as the StartupError, AppError and NotFound boards draw it at the Groups screen's size: a
 * 24 pt glyph in a 56 pt `surface` circle, the title 22/28 bold 20 below it and the text 16/23 `textSecondary` 10
 * below that, centred in the space above the buttons (inset 32, 40 clear of them); then the primary button and, when
 * there is one, a quiet one (44 pt, 8 below), inset 16, with 12 above them and the home indicator's inset below.
 */
import * as SystemUI from 'expo-system-ui';
import { StatusBar } from 'expo-status-bar';
import { useEffect } from 'react';
import { StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { AppText, Button, Icon, type IconName } from '@/components';
import { useTheme } from '@/theme';

export interface ErrorScreenAction {
  label: string;
  onPress: () => void;
}

export interface ErrorScreenProps {
  /** The glyph in the circle: the warning triangle on StartupError and AppError. */
  glyph: IconName;
  title: string;
  text: string;
  /** Announced as an alert (StartupError, AppError); NotFound is a plain screen. */
  alert?: boolean;
  primary: ErrorScreenAction;
  /** The quiet button under the primary one ("Get help", "Report a problem"). */
  quiet?: ErrorScreenAction;
}

/**
 * The native root view under everything React draws has a single fixed colour, the light launch background from the
 * splash plugin. A gesture that moves the whole stack (the interactive pop on iOS) uncovers it, so in dark mode a
 * light strip showed. This keeps it in step with the theme, on both platforms.
 */
export function useNativeBackground(color: string) {
  useEffect(() => {
    void SystemUI.setBackgroundColorAsync(color);
  }, [color]);
}

export function ErrorScreen({
  glyph,
  title,
  text,
  alert = false,
  primary,
  quiet,
}: ErrorScreenProps) {
  const { tokens, scheme } = useTheme();
  const insets = useSafeAreaInsets();
  useNativeBackground(tokens.background);
  return (
    <View
      style={[
        styles.root,
        {
          backgroundColor: tokens.background,
          paddingTop: insets.top,
          paddingBottom: insets.bottom,
        },
      ]}
    >
      <StatusBar style={scheme === 'dark' ? 'light' : 'dark'} />
      <View style={styles.body} accessibilityRole={alert ? 'alert' : undefined}>
        <View style={[styles.glyph, { backgroundColor: tokens.surface }]}>
          <Icon name={glyph} size={24} color={tokens.text} strokeWidth={2} />
        </View>
        <AppText variant="title3" align="center" accessibilityRole="header" style={styles.title}>
          {title}
        </AppText>
        <AppText variant="calloutLoose" color="textSecondary" align="center" style={styles.text}>
          {text}
        </AppText>
      </View>
      <View style={styles.actions}>
        <Button label={primary.label} onPress={primary.onPress} />
        {quiet !== undefined && (
          <Button
            label={quiet.label}
            variant="quiet"
            weight="semibold"
            onPress={quiet.onPress}
            style={styles.quiet}
          />
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  body: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 32,
    paddingBottom: 40,
  },
  glyph: {
    width: 56,
    height: 56,
    borderRadius: 28,
    alignItems: 'center',
    justifyContent: 'center',
  },
  title: { marginTop: 20 },
  text: { marginTop: 10 },
  actions: { paddingTop: 12, paddingHorizontal: 16 },
  quiet: { minHeight: 44, marginTop: 8 },
});
