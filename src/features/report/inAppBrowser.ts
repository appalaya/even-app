import * as WebBrowser from 'expo-web-browser';
import { useCallback } from 'react';
import { Linking } from 'react-native';

import { useTheme } from '@/theme';

/**
 * Opens a page in the in-app browser, as ReportInBrowser draws it: the bar on `surface` with "Done" at its leading
 * edge in the accent, the page's host in the middle (a Safari view controller on iOS; on Android a Custom Tab with
 * its bar on `surface`). Resolves once it closes. Should the in-app browser fail to open (Android with no browser
 * that supports Custom Tabs), the system browser opens the page instead.
 */
export function useInAppBrowser(): (url: string) => Promise<void> {
  const { tokens } = useTheme();
  const { surface, accent } = tokens;
  return useCallback(
    async (url: string) => {
      try {
        await WebBrowser.openBrowserAsync(url, {
          toolbarColor: surface,
          controlsColor: accent,
          dismissButtonStyle: 'done',
          enableBarCollapsing: false,
          readerMode: false,
        });
      } catch {
        await Linking.openURL(url).catch(() => undefined);
      }
    },
    [surface, accent],
  );
}
