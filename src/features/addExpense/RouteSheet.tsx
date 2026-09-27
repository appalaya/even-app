/**
 * A sheet drawn by a route rather than by `Modal`: the kit's `SheetPanel` at the board's top edge (116 on Add
 * expense, Split and Settle), over a scrim, with the kit `Sheet`'s motion (300 ms ease-out in, 220 ms ease-in out,
 * instant under Reduce Motion), swipe-down dismissal and keyboard padding.
 *
 * Why not the kit `Sheet`: it presents on a React Native `Modal`, which sits above every route, so Split (a pushed
 * route, "not a modal in a modal") could never appear over Add expense. Here each route draws its own panel:
 * - `present` (Add expense, Settle): the scrim fades in and the panel slides up; swipe down or tap the scrim to
 *   dismiss.
 * - `push` (Split): no scrim of its own; the panel slides in from the trailing edge over the sheet it was pushed
 *   from, like a push inside the sheet; swipe right to go back.
 * The routes are presented `transparentModal` with no native animation (see `SHEET_ROUTE_OPTIONS`), so the screen
 * underneath stays visible behind the scrim.
 */
import { useCallback, useEffect, useRef, type ReactNode } from 'react';
import { Pressable, StyleSheet, useWindowDimensions, type LayoutChangeEvent } from 'react-native';
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
import { scheduleOnRN } from 'react-native-worklets';

import { useSafeAreaInsets } from 'react-native-safe-area-context';

import {
  KEYBOARD_GAP,
  SheetPanel,
  sheetBottomPad,
  useScrimLayer,
  type SheetPanelProps,
} from '@/components';
import { useTheme } from '@/theme';

/** Options for a route drawn as a sheet: transparent, no native transition (the sheet animates itself). */
export const SHEET_ROUTE_OPTIONS = {
  presentation: 'transparentModal',
  animation: 'none',
  headerShown: false,
  gestureEnabled: false,
  contentStyle: { backgroundColor: 'transparent' },
} as const;

/** The board's top edge for Add expense, Split and Settle. */
export const SHEET_TOP = 116;

export type RouteSheetKind = 'present' | 'push';

export interface RouteSheetController {
  kind: RouteSheetKind;
  progress: SharedValue<number>;
  /** Animates the sheet out, then calls `then` (typically `router.back()`). A second call is ignored. */
  close: (then: () => void) => void;
}

export function useRouteSheet(kind: RouteSheetKind): RouteSheetController {
  const reduceMotion = useReducedMotion();
  const progress = useSharedValue(0);
  const closing = useRef(false);

  useEffect(() => {
    progress.set(
      withTiming(1, { duration: reduceMotion ? 0 : 300, easing: Easing.out(Easing.cubic) }),
    );
  }, [progress, reduceMotion]);

  const close = useCallback(
    (then: () => void) => {
      if (closing.current) return;
      closing.current = true;
      progress.set(
        withTiming(
          0,
          { duration: reduceMotion ? 0 : 220, easing: Easing.in(Easing.cubic) },
          (finished) => {
            'worklet';
            if (finished === true) scheduleOnRN(then);
          },
        ),
      );
    },
    [progress, reduceMotion],
  );

  return { kind, progress, close };
}

export interface RouteSheetProps extends SheetPanelProps {
  sheet: RouteSheetController;
  /** A swipe (down for `present`, right for `push`), a scrim tap, or the VoiceOver escape gesture. */
  onDismiss: () => void;
  top?: number;
  children: ReactNode;
}

export function RouteSheet({ sheet, onDismiss, top = SHEET_TOP, ...panel }: RouteSheetProps) {
  const { tokens } = useTheme();
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();
  const push = sheet.kind === 'push';
  const { progress } = sheet;
  const drag = useSharedValue(0);
  const height = useSharedValue(1000);
  const keyboard = useAnimatedKeyboard();
  // A picker opened over this sheet (Paid by, Date) takes over its scrim: one scrim, as drawn.
  const covered = useScrimLayer(!push);
  const pad = sheetBottomPad(panel.bottom ?? 'home', insets);

  const pan = usePanGesture(
    push
      ? {
          activeOffsetX: 12,
          failOffsetY: [-24, 24],
          onUpdate: (e) => {
            'worklet';
            drag.set(Math.max(0, e.translationX));
          },
          onDeactivate: (e) => {
            'worklet';
            if (e.translationX > 100 || e.velocityX > 900) {
              scheduleOnRN(onDismiss);
            } else {
              drag.set(withTiming(0, { duration: 200, easing: Easing.out(Easing.cubic) }));
            }
          },
        }
      : {
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
        },
  );

  const panelStyle = useAnimatedStyle(() => {
    const away = 1 - progress.get();
    const kb = keyboard.height.get();
    return {
      transform: push
        ? [{ translateX: drag.get() + away * width }]
        : [{ translateY: drag.get() + away * height.get() }],
      // With the keyboard up the content ends 12 above it, as the boards draw.
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
    <GestureHandlerRootView style={StyleSheet.absoluteFill}>
      {!push && (
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
      )}
      <GestureDetector gesture={pan}>
        <Animated.View
          onLayout={onLayout}
          accessibilityViewIsModal
          onAccessibilityEscape={onDismiss}
          style={[styles.sheet, { top }, panelStyle]}
        >
          <SheetPanel {...panel} />
        </Animated.View>
      </GestureDetector>
    </GestureHandlerRootView>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  sheet: { position: 'absolute', left: 0, right: 0, bottom: 0 },
});
