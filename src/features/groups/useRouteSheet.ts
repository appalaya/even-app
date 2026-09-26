/**
 * A route presented as one of the kit's sheets (Create group, Join with code): the route is a transparent modal
 * over Groups and the `Sheet` does the drawn motion. Closing slides the sheet out, then pops the route; leaving for
 * another screen (a new group) replaces the route once the sheet is down.
 */
import { router, type Href } from 'expo-router';
import { useCallback, useRef, useState } from 'react';
import { useReducedMotion } from 'react-native-reanimated';

/** The kit Sheet's exit (220 ms) plus a frame. */
const EXIT_MS = 240;

export function useRouteSheet() {
  const reduceMotion = useReducedMotion();
  const [visible, setVisible] = useState(true);
  const leaving = useRef(false);

  const after = useCallback(
    (then: () => void) => {
      if (leaving.current) return;
      leaving.current = true;
      setVisible(false);
      setTimeout(then, reduceMotion ? 0 : EXIT_MS);
    },
    [reduceMotion],
  );

  /** Cancel, a scrim tap or a swipe down: back to where the sheet was opened from. */
  const close = useCallback(
    () =>
      after(() => {
        if (router.canGoBack()) router.back();
        else router.replace('/' as Href);
      }),
    [after],
  );

  /** Done: replace the sheet's route with `href` (the new or joined group). */
  const leaveTo = useCallback((href: Href) => after(() => router.replace(href)), [after]);

  return { visible, close, leaveTo };
}
