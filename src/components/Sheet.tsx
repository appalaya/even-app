import { useEffect, useState, type ReactNode } from 'react';
import { Modal, Pressable, StyleSheet, View, type LayoutChangeEvent } from 'react-native';
import {
  GestureDetector,
  GestureHandlerRootView,
  usePanGesture,
} from 'react-native-gesture-handler';
import Animated, {
  Easing,
  useAnimatedKeyboard,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withTiming,
  type SharedValue,
} from 'react-native-reanimated';
import { useSafeAreaInsets, type EdgeInsets } from 'react-native-safe-area-context';
import { scheduleOnRN } from 'react-native-worklets';

import { layout, radii, useTheme } from '@/theme';

import { AppText } from './AppText';
import { Icon } from './Icon';

export interface SheetAction {
  label: string;
  onPress: () => void;
  disabled?: boolean;
  /** Draw as a back button (chevron and label), as Split's "‹ New expense". */
  back?: boolean;
}

export interface SheetHeaderProps {
  /** A text action at the leading edge ("Cancel", 17/22 regular accent) or a back button. */
  leftAction?: SheetAction;
  /** A text action at the trailing edge ("Done", 17/22 semibold accent; `textDisabled` when disabled). */
  rightAction?: SheetAction;
  /** A 20/25 semibold title with the round close button (Done adding). */
  title?: ReactNode;
  /**
   * A 17/22 semibold title centred in the action row ("New expense", "Split", "Record a payment", "Join with
   * code", "New group").
   */
  navTitle?: string;
  /** How far the centred title stays from each edge, as drawn: 110 (default), 100 for longer titles, 150 for
   * "Split" between a back button and "Done". */
  navTitleInset?: number;
  /** The round close button alone at the trailing edge (Join). */
  onClose?: () => void;
}

export interface SheetPanelProps extends SheetHeaderProps {
  children: ReactNode;
  /** Bottom padding: `home` 34 (default) or `keypad` 30 for sheets that end in a keypad. */
  bottom?: 'home' | 'keypad';
  accessibilityLabel: string;
}

/** The panel's bottom padding: 34 above the home indicator, or 30 for a sheet that ends in a keypad. */
export function sheetBottomPad(bottom: 'home' | 'keypad', insets: EdgeInsets): number {
  return bottom === 'keypad'
    ? Math.max(insets.bottom - 4, layout.keypadSheetBottom)
    : Math.max(insets.bottom, layout.homeIndicator);
}

/** With the keyboard up, a sheet's content ends this far above it (every board that draws the keyboard). */
export const KEYBOARD_GAP = 12;

// ---------- One scrim for stacked sheets ----------

/**
 * Sheets open over sheets (the emoji and currency pickers over Create group, Paid by over Add expense, "Is that you on
 * another phone?" over the name pick). The boards draw one scrim under the top sheet and over everything below it
 * (Groups, create and join, extra states: Currency picker; Add expense, extra states: Paid by picker), so a sheet's
 * scrim fades out while another sheet is open above it and back in when that one goes.
 */
const layers = new Map<number, number>();
const layerListeners = new Set<() => void>();
let layerIds = 0;
let layerOrder = 0;

function coveredLayer(id: number): boolean {
  const at = layers.get(id);
  if (at === undefined) return false;
  for (const other of layers.values()) if (other > at) return true;
  return false;
}

/**
 * Registers a sheet that draws a scrim while `visible`, and returns 1 while another scrim sheet is open above it
 * (animated, 300 ms), 0 otherwise. Multiply the scrim's opacity by `1 − covered`.
 */
export function useScrimLayer(visible: boolean): SharedValue<number> {
  const reduceMotion = useReducedMotion();
  const [id] = useState(() => (layerIds += 1));
  const covered = useSharedValue(0);
  useEffect(() => {
    const update = () => {
      covered.set(
        withTiming(coveredLayer(id) ? 1 : 0, {
          duration: reduceMotion ? 0 : 300,
          easing: Easing.out(Easing.cubic),
        }),
      );
    };
    layerListeners.add(update);
    return () => {
      layerListeners.delete(update);
    };
  }, [id, covered, reduceMotion]);
  useEffect(() => {
    if (!visible) return;
    layers.set(id, (layerOrder += 1));
    for (const listener of [...layerListeners]) listener();
    return () => {
      layers.delete(id);
      for (const listener of [...layerListeners]) listener();
    };
  }, [id, visible]);
  return covered;
}

/**
 * The sheet's visual container, without presentation: `surface`, 28 top corners, the 36 × 5 grabber 6 below the
 * top edge, and the header the board draws. `Sheet` presents it; the kit gallery also shows it inline.
 */
export function SheetPanel({
  children,
  bottom = 'home',
  accessibilityLabel,
  ...header
}: SheetPanelProps) {
  const { tokens } = useTheme();
  const insets = useSafeAreaInsets();
  const pad = sheetBottomPad(bottom, insets);
  return (
    <View
      accessibilityLabel={accessibilityLabel}
      style={[styles.panel, { backgroundColor: tokens.surface, paddingBottom: pad }]}
    >
      <View style={[styles.grabber, { backgroundColor: tokens.grabber }]} />
      <SheetHeader {...header} />
      {children}
    </View>
  );
}

export function SheetHeader({
  leftAction,
  rightAction,
  title,
  navTitle,
  navTitleInset = 110,
  onClose,
}: SheetHeaderProps) {
  if (title !== undefined) {
    return (
      <View style={styles.titleRow}>
        <View style={styles.flex}>
          {typeof title === 'string' ? (
            <AppText variant="headline" accessibilityRole="header">
              {title}
            </AppText>
          ) : (
            title
          )}
        </View>
        {onClose !== undefined && <SheetCloseButton onPress={onClose} />}
      </View>
    );
  }
  if (leftAction !== undefined || rightAction !== undefined || navTitle !== undefined) {
    const back = leftAction?.back === true;
    return (
      <View style={[styles.actionRow, back ? styles.actionRowBack : styles.actionRowText]}>
        {leftAction !== undefined && <HeaderAction action={leftAction} side="left" />}
        {navTitle !== undefined && (
          <View pointerEvents="none" style={[styles.navTitle, { marginHorizontal: navTitleInset }]}>
            <AppText weight="semibold" numberOfLines={1} accessibilityRole="header">
              {navTitle}
            </AppText>
          </View>
        )}
        {rightAction !== undefined && (
          <HeaderAction action={rightAction} side="right" padded={back} />
        )}
      </View>
    );
  }
  if (onClose !== undefined) {
    return (
      <View style={styles.closeRow}>
        <SheetCloseButton onPress={onClose} />
      </View>
    );
  }
  return null;
}

/**
 * `padded`: the trailing action in Split's back-button row pads 12 at each side (20 from the edge, as drawn);
 * in a text row (Rename group, Date) it sits on the row's 16 pt inset.
 */
function HeaderAction({
  action,
  side,
  padded = false,
}: {
  action: SheetAction;
  side: 'left' | 'right';
  padded?: boolean;
}) {
  const { tokens } = useTheme();
  const disabled = action.disabled === true;
  return (
    <Pressable
      onPress={action.onPress}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityLabel={action.back === true ? `Back to ${action.label}` : action.label}
      accessibilityState={{ disabled }}
      hitSlop={side === 'right' && !padded ? { left: 12, right: 12 } : undefined}
      style={({ pressed }) => [
        styles.headerAction,
        side === 'right' && styles.headerActionRight,
        side === 'right' && padded && styles.headerActionPadded,
        action.back === true && styles.headerActionBack,
        pressed && styles.pressed,
      ]}
    >
      {action.back === true && <Icon name="chevronLeft" size={24} color={tokens.accent} />}
      <AppText
        weight={side === 'right' ? 'semibold' : 'regular'}
        color={disabled ? 'textDisabled' : 'accent'}
      >
        {action.label}
      </AppText>
    </Pressable>
  );
}

/** A 30 pt `fillMuted` circle with a 12 pt × in `textSecondary`, centred in a 44 pt target. */
export function SheetCloseButton({ onPress }: { onPress: () => void }) {
  const { tokens } = useTheme();
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel="Close"
      style={({ pressed }) => [styles.closeTarget, pressed && styles.pressed]}
    >
      <View style={[styles.closeCircle, { backgroundColor: tokens.fillMuted }]}>
        <Icon name="close" size={12} color={tokens.textSecondary} />
      </View>
    </Pressable>
  );
}

export interface SheetProps extends SheetPanelProps {
  visible: boolean;
  /** Called on a scrim tap, a swipe down, the close button's owner, or the VoiceOver escape gesture. */
  onDismiss: () => void;
  /**
   * The sheet's top edge measured from the top of the screen, as drawn (116 for Add expense, 130 for Done adding,
   * 150 for Join with code). Omit to size the sheet to its content.
   */
  top?: number;
}

/**
 * A bottom sheet on `Modal`: the scrim fades in while the panel slides up (300 ms ease-out; instant under Reduce
 * Motion). Dismiss by tapping the scrim, swiping down past 120 pt (or flicking), or the escape gesture. With the
 * keyboard up the panel's content ends 12 above it, as the boards draw. Opened over another sheet, it takes over
 * that sheet's scrim (`useScrimLayer`).
 */
export function Sheet({ visible, onDismiss, top, ...panel }: SheetProps) {
  const { tokens } = useTheme();
  const insets = useSafeAreaInsets();
  const reduceMotion = useReducedMotion();
  const [mounted, setMounted] = useState(visible);
  const progress = useSharedValue(0);
  const drag = useSharedValue(0);
  const height = useSharedValue(1000);
  const keyboard = useAnimatedKeyboard();
  const covered = useScrimLayer(visible);
  const pad = sheetBottomPad(panel.bottom ?? 'home', insets);

  if (visible && !mounted) setMounted(true);

  useEffect(() => {
    const duration = reduceMotion ? 0 : visible ? 300 : 220;
    if (visible) {
      drag.set(0);
      progress.set(withTiming(1, { duration, easing: Easing.out(Easing.cubic) }));
    } else {
      progress.set(
        withTiming(0, { duration, easing: Easing.in(Easing.cubic) }, (finished) => {
          'worklet';
          if (finished === true) scheduleOnRN(setMounted, false);
        }),
      );
    }
  }, [visible, reduceMotion, progress, drag]);

  const pan = usePanGesture({
    activeOffsetY: 12,
    failOffsetX: [-24, 24],
    onUpdate: (e) => {
      'worklet';
      drag.set(Math.max(0, e.translationY));
    },
    onDeactivate: (e) => {
      'worklet';
      if (e.translationY > 120 || e.velocityY > 900) {
        scheduleOnRN(onDismiss);
      } else {
        drag.set(withTiming(0, { duration: 200, easing: Easing.out(Easing.cubic) }));
      }
    },
  });

  const panelStyle = useAnimatedStyle(() => {
    const kb = keyboard.height.get();
    return {
      transform: [{ translateY: drag.get() + (1 - progress.get()) * height.get() }],
      marginBottom: kb > 0 ? Math.max(0, kb + KEYBOARD_GAP - pad) : 0,
    };
  });
  const scrimStyle = useAnimatedStyle(() => ({
    opacity: progress.get() * (1 - covered.get()),
  }));

  const onLayout = (e: LayoutChangeEvent) => {
    height.set(e.nativeEvent.layout.height);
  };

  return (
    <Modal
      transparent
      visible={mounted}
      animationType="none"
      statusBarTranslucent
      onRequestClose={onDismiss}
    >
      <GestureHandlerRootView style={styles.flex}>
        <Animated.View
          style={[StyleSheet.absoluteFill, { backgroundColor: tokens.scrim }, scrimStyle]}
        >
          <Pressable
            style={styles.flex}
            onPress={onDismiss}
            accessibilityElementsHidden
            importantForAccessibility="no"
          />
        </Animated.View>
        <GestureDetector gesture={pan}>
          <Animated.View
            onLayout={onLayout}
            accessibilityViewIsModal
            onAccessibilityEscape={onDismiss}
            style={[styles.sheet, top !== undefined && { top }, panelStyle]}
          >
            <SheetPanel {...panel} />
          </Animated.View>
        </GestureDetector>
      </GestureHandlerRootView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  sheet: { position: 'absolute', left: 0, right: 0, bottom: 0 },
  panel: {
    flexGrow: 1,
    borderTopLeftRadius: radii.sheet,
    borderTopRightRadius: radii.sheet,
  },
  grabber: {
    width: 36,
    height: 5,
    marginTop: 6,
    alignSelf: 'center',
    borderRadius: radii.grabber,
  },
  titleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingTop: 4,
    paddingLeft: 20,
    paddingRight: 8,
  },
  actionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    minHeight: layout.navBarHeight,
    marginTop: 4,
  },
  actionRowText: { paddingHorizontal: 16 },
  navTitle: {
    position: 'absolute',
    top: 0,
    bottom: 0,
    left: 0,
    right: 0,
    alignItems: 'center',
    justifyContent: 'center',
  },
  actionRowBack: { paddingLeft: 4, paddingRight: 8 },
  headerAction: {
    minHeight: layout.tapTarget,
    flexDirection: 'row',
    alignItems: 'center',
  },
  headerActionBack: { gap: 2, paddingRight: 8 },
  headerActionRight: { marginLeft: 'auto' },
  headerActionPadded: { paddingHorizontal: 12 },
  closeRow: { flexDirection: 'row', justifyContent: 'flex-end', paddingHorizontal: 8 },
  closeTarget: {
    width: layout.tapTarget,
    height: layout.tapTarget,
    alignItems: 'center',
    justifyContent: 'center',
  },
  closeCircle: {
    width: 30,
    height: 30,
    borderRadius: 15,
    alignItems: 'center',
    justifyContent: 'center',
  },
  pressed: { opacity: 0.5 },
});
