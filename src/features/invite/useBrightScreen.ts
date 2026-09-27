/**
 * Full screen brightness while a QR is up for someone else's camera (InviteQR), restored when it goes.
 *
 * iOS sets the screen's own brightness, which outlives the app, so the previous level is read first and put back on
 * close and whenever the app leaves the foreground (then raised again on return). Android sets this window's
 * brightness only and hands it back to the system setting on close.
 */
import * as Brightness from 'expo-brightness';
import { useEffect } from 'react';
import { AppState, Platform } from 'react-native';

export function useBrightScreen(active: boolean): void {
  useEffect(() => {
    if (!active) return;
    let saved: number | null = null;
    let raised = false;
    let cancelled = false;

    const raise = async () => {
      if (raised) return;
      try {
        saved = await Brightness.getBrightnessAsync();
        if (cancelled) return;
        raised = true;
        await Brightness.setBrightnessAsync(1);
      } catch {
        // Brightness is a nicety: a phone that refuses keeps its level.
      }
    };
    const restore = async () => {
      if (!raised) return;
      raised = false;
      try {
        if (Platform.OS === 'android') await Brightness.restoreSystemBrightnessAsync();
        else if (saved !== null) await Brightness.setBrightnessAsync(saved);
      } catch {
        // As above.
      }
    };

    void raise();
    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'active') void raise();
      else void restore();
    });
    return () => {
      cancelled = true;
      sub.remove();
      void restore();
    };
  }, [active]);
}
