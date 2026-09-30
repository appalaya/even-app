import { useCallback, useEffect, useState, type ReactNode } from 'react';
import {
  Dimensions,
  Keyboard,
  Modal,
  Platform,
  Pressable,
  StyleSheet,
  View,
  type LayoutChangeEvent,
} from 'react-native';
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
import { navTitlePlacement } from './sheetHeaderLogic';

export interface SheetAction {
  label: string;
  onPress: () => void;
  disabled?: boolean;
  /**
   * Draw as a back button (chevron and label), as Split's "‹ New expense". At the largest text sizes its label takes
   * the room the trailing action leaves and ends in an ellipsis.
   */
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
   * code", "New group"). At the largest text sizes it gives way to the actions (`NavTitle`), and is not drawn when
   * they leave it no room.
   */
  navTitle?: string;
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

/**
 * How far the keyboard reaches up from the bottom of the screen, for a sheet. Reanimated's `useAnimatedKeyboard` reads
 * it on iOS. On Android a sheet is a `Modal`, a window of its own, and the hook follows the activity's window, so it
 * read 0 there and the keyboard covered the sheet's foot (Join, Create group, Rename's field). React Native's keyboard
 * events do fire for the Modal's window, so on Android the sheet follows them, measured from the screen's bottom edge
 * as the hook measures (the keyboard's own height leaves out the navigation bar under it).
 */
function useSheetKeyboard(): SharedValue<number> {
  const animated = useAnimatedKeyboard();
  const android = useSharedValue(0);
  useEffect(() => {
    if (Platform.OS !== 'android') return;
    const shown = Keyboard.addListener('keyboardDidShow', (e) => {
      const fromBottom = Dimensions.get('screen').height - e.endCoordinates.screenY;
      android.set(withTiming(Math.max(0, fromBottom), { duration: 200 }));
    });
    const hidden = Keyboard.addListener('keyboardDidHide', () => {
      android.set(withTiming(0, { duration: 200 }));
    });
    return () => {
      shown.remove();
      hidden.remove();
    };
  }, [android]);
  return Platform.OS === 'android' ? android : animated.height;
}

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
  onClose,
}: SheetHeaderProps) {
  // Where the actions are, measured, so the centred title keeps clear of them (`NavTitle`).
  const [edges, setEdges] = useState<NavEdges>({ width: 0, leftEnd: 0, rightStart: null });
  const onRowLayout = useCallback((e: LayoutChangeEvent) => {
    const { width } = e.nativeEvent.layout;
    setEdges((prev) => (prev.width === width ? prev : { ...prev, width }));
  }, []);
  const onLeftLayout = useCallback((e: LayoutChangeEvent) => {
    const { x, width } = e.nativeEvent.layout;
    setEdges((prev) => (prev.leftEnd === x + width ? prev : { ...prev, leftEnd: x + width }));
  }, []);
  const onRightLayout = useCallback((e: LayoutChangeEvent) => {
    const { x } = e.nativeEvent.layout;
    setEdges((prev) => (prev.rightStart === x ? prev : { ...prev, rightStart: x }));
  }, []);
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
    const inset = back ? ROW_INSET_BACK : ROW_INSET_TEXT;
    return (
      <View
        onLayout={onRowLayout}
        style={[styles.actionRow, back ? styles.actionRowBack : styles.actionRowText]}
      >
        {leftAction !== undefined && (
          <HeaderAction action={leftAction} side="left" onLayout={onLeftLayout} />
        )}
        {navTitle !== undefined && (
          <NavTitle
            title={navTitle}
            rowWidth={edges.width}
            clearLeft={leftAction === undefined ? inset.left : edges.leftEnd + NAV_TITLE_GAP}
            clearRight={
              rightAction === undefined || edges.rightStart === null
                ? inset.right
                : edges.width - edges.rightStart + NAV_TITLE_GAP
            }
          />
        )}
        {rightAction !== undefined && (
          <HeaderAction action={rightAction} side="right" padded={back} onLayout={onRightLayout} />
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
 * Where the action row's pieces are, from its layout: its width, where the leading action ends, and where the
 * trailing one starts (null until measured).
 */
interface NavEdges {
  width: number;
  leftEnd: number;
  rightStart: number | null;
}

/** The least space between the centred title and an action. */
const NAV_TITLE_GAP = 8;
/** The action row's horizontal padding: 16 each side in a text row, 4 and 8 in a back-button row (Split). */
const ROW_INSET_TEXT = { left: 16, right: 16 } as const;
const ROW_INSET_BACK = { left: 4, right: 8 } as const;

/**
 * The centred title, laid over the whole action row. At the default sizes every title fits between the actions and
 * sits in the middle of the sheet, where the boards draw it. At the largest text sizes the actions keep their width
 * and the title gives way (`navTitlePlacement`): it moves off centre only as far as it must, into the room the
 * actions leave, and ends in an ellipsis when even that is too narrow. When the actions leave no room at all (a back
 * label cut short beside Done) it is not drawn (opacity 0), and keeps its header role. Its uncut width is read from a
 * hidden copy.
 */
function NavTitle({
  title,
  rowWidth,
  clearLeft,
  clearRight,
}: {
  title: string;
  rowWidth: number;
  clearLeft: number;
  clearRight: number;
}) {
  const [titleWidth, setTitleWidth] = useState<number | null>(null);
  const onMeasure = useCallback((e: LayoutChangeEvent) => {
    setTitleWidth(e.nativeEvent.layout.width);
  }, []);
  const placement = navTitlePlacement(rowWidth, titleWidth, clearLeft, clearRight);
  return (
    <View
      pointerEvents="none"
      style={[
        styles.navTitle,
        placement !== 'center' &&
          placement !== 'hidden' && {
            paddingLeft: clearLeft,
            paddingRight: clearRight,
            alignItems: placement === 'fill' ? 'center' : placement,
          },
        placement === 'hidden' && styles.navTitleHidden,
      ]}
    >
      <AppText weight="semibold" numberOfLines={1} accessibilityRole="header">
        {title}
      </AppText>
      <AppText
        weight="semibold"
        numberOfLines={1}
        onLayout={onMeasure}
        style={styles.navTitleMeasure}
        accessible={false}
        accessibilityElementsHidden
        importantForAccessibility="no-hide-descendants"
      >
        {title}
      </AppText>
    </View>
  );
}

/**
 * `padded`: the trailing action in Split's back-button row pads 12 at each side (20 from the edge, as drawn);
 * in a text row (Rename group, Date) it sits on the row's 16 pt inset. A text action ("Cancel", "Done") never
 * shrinks or truncates: the title gives way instead. A back button's label is the one exception: at the largest
 * text sizes it takes what the trailing action leaves and ends in an ellipsis, as the full screen's `BackButton`
 * does, so Done stays whole and on screen.
 */
function HeaderAction({
  action,
  side,
  padded = false,
  onLayout,
}: {
  action: SheetAction;
  side: 'left' | 'right';
  padded?: boolean;
  onLayout?: (e: LayoutChangeEvent) => void;
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
      onLayout={onLayout}
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
        numberOfLines={action.back === true ? 1 : undefined}
        style={action.back === true ? styles.backLabel : undefined}
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
  const keyboard = useSheetKeyboard();
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
    const kb = keyboard.get();
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
  navTitleMeasure: { position: 'absolute', left: 0, top: 0, opacity: 0 },
  navTitleHidden: { opacity: 0 },
  actionRowBack: { paddingLeft: 4, paddingRight: 8 },
  headerAction: {
    minHeight: layout.tapTarget,
    flexDirection: 'row',
    alignItems: 'center',
    flexShrink: 0,
  },
  // A back button may shrink (its label truncates); the chevron keeps its size.
  headerActionBack: { gap: 2, paddingRight: 8, flexShrink: 1 },
  backLabel: { flexShrink: 1 },
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
