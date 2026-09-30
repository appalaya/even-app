/**
 * About (AppAbout, AppAboutDark), pushed from App settings' "About" row: "‹ Settings" with "About" centred in the
 * nav bar; 28 below it the mark at 64 pt in the accent, "Even" 28/34 bold 12 under it, and the version ("1.0 (120)",
 * 15/20 `textMuted`, tabular) 2 under that. Then, 28 below, one card of Privacy, Terms and Source code (each opens
 * in the in-app browser, as Help and feedback does), and 20 below it a card with "Diagnostics ›" and its caption
 * (`diagnosticsCaption`: on Android it leaves out the model, as Diagnostics does there).
 */
import { router } from 'expo-router';
import { Platform, StyleSheet, View } from 'react-native';

import { AppText, Card, Footnote, ListRow, Mark, Screen } from '@/components';
import { useInAppBrowser } from '@/features/report/inAppBrowser';
import { hrefs } from '@/features/groups/routes';
import { diagnosticsCaption, LINKS } from '@/features/settings/about';
import { APP_VERSION } from '@/features/settings/appVersion';
import { layout } from '@/theme';

export default function AboutScreen() {
  const openPage = useInAppBrowser();
  const back = () => (router.canGoBack() ? router.back() : router.replace(hrefs.settings));
  return (
    <Screen back={{ label: 'Settings', onPress: back }} title="About">
      <View style={styles.brand}>
        <Mark size={64} />
        <AppText variant="appName" style={styles.name}>
          Even
        </AppText>
        <AppText variant="subhead" color="textMuted" tabular style={styles.version}>
          {APP_VERSION}
        </AppText>
      </View>
      <Card radius="group" separatorInset={16} style={styles.links}>
        <ListRow
          title="Privacy"
          chevron
          minHeight={48}
          onPress={() => void openPage(LINKS.privacy)}
        />
        <ListRow title="Terms" chevron minHeight={48} onPress={() => void openPage(LINKS.terms)} />
        <ListRow
          title="Source code"
          chevron
          minHeight={48}
          onPress={() => void openPage(LINKS.source)}
        />
      </Card>
      <Card radius="group" style={styles.card}>
        <ListRow
          title="Diagnostics"
          chevron
          minHeight={48}
          onPress={() => router.push(hrefs.diagnostics)}
        />
      </Card>
      <Footnote>{diagnosticsCaption(Platform.OS)}</Footnote>
    </Screen>
  );
}

const styles = StyleSheet.create({
  brand: { alignItems: 'center', marginTop: 28 },
  name: { marginTop: 12 },
  version: { marginTop: 2 },
  links: { marginTop: 28, marginHorizontal: layout.gutter },
  card: { marginTop: 20, marginHorizontal: layout.gutter },
});
