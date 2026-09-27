/**
 * Group's share arrow and its menu (GroupShareMenu, GroupShareMenuDark). The arrow in the nav bar opens a small menu
 * anchored under it: "Share link" (the system share sheet, `shareInvite`) and "Show QR code" ("Scan to join",
 * `InviteQrSheet`), over a light scrim (`menuScrim`) that covers the whole screen, nav bar and footer included; a tap
 * on the scrim closes it. While the menu is open the arrow sits on a 44 pt `accentSoft` circle.
 *
 * iOS would put a UIMenu on a native nav-bar button, but Group's nav bar is the kit's drawn `Screen` (the native
 * header is hidden) and its `HeaderButton` is a Pressable that cannot host one, so both platforms draw this menu; on
 * Android it is the dropdown, and the back button closes it.
 */
import { useEffect } from 'react';
import { BackHandler, Pressable, StyleSheet, View } from 'react-native';
import Animated, { FadeIn, FadeOut } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { AppText, Icon, type IconName } from '@/components';
import { layout, radii, strokes, useTheme } from '@/theme';

/** As drawn: 4 below the nav bar (top 110 on the 874 pt board), 16 from the trailing edge, 250 wide. */
const MENU_GAP = 4;
const MENU_RIGHT = 16;
const MENU_WIDTH = 250;
/** The menu's rows and its fade (no board draws the motion; a short fade, as a system menu). */
const ROW_HEIGHT = 48;
const FADE_IN_MS = 150;
const FADE_OUT_MS = 120;

/**
 * The share arrow: 44 × 44 in the accent, `textDisabled` and not pressable until the invite is ready; while its menu
 * is open (`expanded`) it sits on a round `accentSoft` backdrop (GroupShareMenu).
 */
export function ShareButton({
  expanded,
  disabled,
  onPress,
}: {
  expanded: boolean;
  disabled: boolean;
  onPress: () => void;
}) {
  const { tokens } = useTheme();
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityLabel="Share invite"
      accessibilityState={{ disabled, expanded }}
      style={({ pressed }) => [
        styles.button,
        expanded && { backgroundColor: tokens.accentSoft },
        pressed && !disabled && !expanded && styles.pressed,
      ]}
    >
      <Icon name="share" size={22} color={disabled ? tokens.textDisabled : tokens.accent} />
    </Pressable>
  );
}

export interface ShareMenuProps {
  visible: boolean;
  /** "Share Banff 2026", the menu's spoken name. */
  groupName: string;
  onDismiss: () => void;
  onShareLink: () => void;
  onShowQr: () => void;
}

/**
 * The menu over the whole screen: render it after the `Screen`, in a container that fills it. `surface`, radius 14,
 * a `0 10px 30px` `menuShadow` and a 1 pt `border` ring; 48 pt rows padded 16, the label 17/22 `text` and a 20 pt
 * glyph in `text` at the trailing edge, 12 apart; a full-width `separator` between them.
 */
export function ShareMenu({
  visible,
  groupName,
  onDismiss,
  onShareLink,
  onShowQr,
}: ShareMenuProps) {
  const { tokens } = useTheme();
  const insets = useSafeAreaInsets();

  useEffect(() => {
    if (!visible) return;
    const subscription = BackHandler.addEventListener('hardwareBackPress', () => {
      onDismiss();
      return true;
    });
    return () => subscription.remove();
  }, [visible, onDismiss]);

  if (!visible) return null;
  return (
    <Animated.View
      entering={FadeIn.duration(FADE_IN_MS)}
      exiting={FadeOut.duration(FADE_OUT_MS)}
      style={StyleSheet.absoluteFill}
      accessibilityViewIsModal
    >
      <Pressable
        style={[StyleSheet.absoluteFill, { backgroundColor: tokens.menuScrim }]}
        onPress={onDismiss}
        accessibilityRole="button"
        accessibilityLabel="Close menu"
      />
      <View
        accessibilityRole="menu"
        accessibilityLabel={`Share ${groupName}`}
        style={[
          styles.menu,
          {
            top: insets.top + layout.navBarHeight + MENU_GAP,
            backgroundColor: tokens.surface,
            boxShadow: `0 10px 30px ${tokens.menuShadow}, 0 0 0 ${strokes.hairline}px ${tokens.border}`,
          },
        ]}
      >
        <View style={styles.clip}>
          <MenuRow label="Share link" icon="share" onPress={onShareLink} />
          <View style={[styles.separator, { backgroundColor: tokens.separator }]} />
          <MenuRow label="Show QR code" icon="qr" onPress={onShowQr} />
        </View>
      </View>
    </Animated.View>
  );
}

function MenuRow({ label, icon, onPress }: { label: string; icon: IconName; onPress: () => void }) {
  const { tokens } = useTheme();
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="menuitem"
      accessibilityLabel={label}
      style={({ pressed }) => [styles.row, pressed && { backgroundColor: tokens.rowPressed }]}
    >
      <AppText style={styles.flex}>{label}</AppText>
      <Icon name={icon} size={20} color={tokens.text} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  button: {
    width: layout.tapTarget,
    height: layout.tapTarget,
    borderRadius: layout.tapTarget / 2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  pressed: { opacity: 0.5 },
  menu: {
    position: 'absolute',
    right: MENU_RIGHT,
    width: MENU_WIDTH,
    borderRadius: radii.tile,
  },
  clip: { borderRadius: radii.tile, overflow: 'hidden' },
  row: {
    minHeight: ROW_HEIGHT,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingHorizontal: 16,
  },
  separator: { height: strokes.hairline },
});
