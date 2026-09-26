import type { ReactNode } from 'react';
import { Pressable, ScrollView, StyleSheet, View, type ScrollViewProps } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { layout, useTheme } from '@/theme';

import { AppText } from './AppText';
import { Icon, type IconName } from './Icon';

export interface ScreenProps {
  children: ReactNode;
  /**
   * A large title row: a string renders 34/41 bold ("Groups", "Settings"); a node renders as given (the
   * `Wordmark` on Groups when empty). With `back`, it sits under the nav bar as on App settings.
   */
  largeTitle?: ReactNode;
  /** A back button at the leading edge of the nav bar: chevron and the previous screen's name, in the accent. */
  back?: { label: string; onPress: () => void };
  /** A centred nav bar title ("Banff 2026"). */
  title?: string;
  /** How far the centred title stays from each edge: 110 (default), 130 on Group settings. */
  titleInset?: number;
  /** Icon buttons at the trailing edge of the nav bar or of the large title row (`HeaderButton`). */
  headerRight?: ReactNode;
  /** A sticky footer on the canvas colour: 12 pt above, the gutter at the sides, the home-indicator inset below. */
  footer?: ReactNode;
  /** Scrolls the content (default). Set false for a screen that lays out its own fill. */
  scroll?: boolean;
  contentContainerStyle?: ScrollViewProps['contentContainerStyle'];
  testID?: string;
}

/** A full screen on the canvas colour, inside the safe area, with the canvas's nav bar and large title. */
export function Screen({
  children,
  largeTitle,
  back,
  title,
  titleInset = 110,
  headerRight,
  footer,
  scroll = true,
  contentContainerStyle,
  testID,
}: ScreenProps) {
  const { tokens } = useTheme();
  const insets = useSafeAreaInsets();
  const bottom = Math.max(insets.bottom, layout.homeIndicator);
  const hasNav = back !== undefined || title !== undefined;

  return (
    <View
      testID={testID}
      style={[styles.screen, { backgroundColor: tokens.background, paddingTop: insets.top }]}
    >
      {hasNav && (
        <View style={styles.nav}>
          {back !== undefined && <BackButton label={back.label} onPress={back.onPress} />}
          {title !== undefined && (
            <View pointerEvents="none" style={[styles.navTitle, { marginHorizontal: titleInset }]}>
              <AppText weight="semibold" numberOfLines={1} accessibilityRole="header">
                {title}
              </AppText>
            </View>
          )}
          {largeTitle === undefined && headerRight !== undefined && (
            <View style={styles.trailing}>{headerRight}</View>
          )}
        </View>
      )}
      {largeTitle !== undefined && (
        <View style={hasNav ? styles.largeTitleUnderNav : styles.largeTitle}>
          <View style={styles.flex}>
            {typeof largeTitle === 'string' ? (
              <AppText variant="largeTitle" accessibilityRole="header">
                {largeTitle}
              </AppText>
            ) : (
              largeTitle
            )}
          </View>
          {headerRight}
        </View>
      )}
      {scroll ? (
        <ScrollView
          style={styles.flex}
          contentContainerStyle={[{ paddingBottom: footer ? 16 : bottom }, contentContainerStyle]}
          keyboardShouldPersistTaps="handled"
        >
          {children}
        </ScrollView>
      ) : (
        <View style={[styles.flex, contentContainerStyle]}>{children}</View>
      )}
      {footer !== undefined && (
        <View
          style={[styles.footer, { backgroundColor: tokens.background, paddingBottom: bottom }]}
        >
          {footer}
        </View>
      )}
    </View>
  );
}

/** Chevron and label, 17/22 in the accent; 44 pt tall. */
export function BackButton({ label, onPress }: { label: string; onPress: () => void }) {
  const { tokens } = useTheme();
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={`Back to ${label}`}
      style={({ pressed }) => [styles.back, pressed && styles.pressed]}
    >
      <Icon name="chevronLeft" size={24} color={tokens.accent} />
      <AppText color="accent" numberOfLines={1}>
        {label}
      </AppText>
    </Pressable>
  );
}

export interface HeaderButtonProps {
  icon: IconName;
  /** Spoken name ("Settings", "Share invite", "Group settings"). */
  accessibilityLabel: string;
  onPress: () => void;
  /** Glyph size: 22 in a nav bar (default), 24 beside a large title. */
  size?: 22 | 24;
}

/** A 44 × 44 icon button in the accent (gear, share). */
export function HeaderButton({ icon, accessibilityLabel, onPress, size = 22 }: HeaderButtonProps) {
  const { tokens } = useTheme();
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      style={({ pressed }) => [styles.headerButton, pressed && styles.pressed]}
    >
      <Icon name={icon} size={size} color={tokens.accent} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  flex: { flex: 1 },
  nav: {
    minHeight: layout.navBarHeight,
    flexDirection: 'row',
    alignItems: 'center',
    paddingLeft: 4,
    paddingRight: 8,
  },
  navTitle: {
    position: 'absolute',
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
    alignItems: 'center',
    justifyContent: 'center',
  },
  trailing: { marginLeft: 'auto', flexDirection: 'row' },
  back: {
    minHeight: layout.tapTarget,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 2,
    paddingRight: 8,
  },
  headerButton: {
    width: layout.tapTarget,
    height: layout.tapTarget,
    alignItems: 'center',
    justifyContent: 'center',
  },
  largeTitle: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingTop: layout.largeTitle.top,
    paddingRight: layout.largeTitle.right,
    paddingBottom: layout.largeTitle.bottom,
    paddingLeft: layout.largeTitle.left,
  },
  largeTitleUnderNav: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingTop: 4,
    paddingHorizontal: layout.textInset,
  },
  footer: { paddingTop: layout.footerTop, paddingHorizontal: layout.gutter },
  pressed: { opacity: 0.5 },
});
