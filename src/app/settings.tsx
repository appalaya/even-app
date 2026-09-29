/**
 * App settings (AppSettings, AppSettingsDark), pushed from the gear on Groups: "‹ Groups", the large title
 * "Settings", then You (avatar and Name), Appearance (System · Light · Dark), Notifications (no sentence under it),
 * Groups → Import group file, Help → Help and feedback (the contact page in the in-app browser, with nothing about
 * any group), and one "About ›" row, which pushes About (Privacy, Terms, Source code, the version, Diagnostics). No
 * background-sync switch exists.
 *
 * Spacing as drawn: section headers 16 above and 6 below, inset 20; the Appearance, Notifications and About cards 20
 * below what precedes them; footnotes 6 under their card; every card inset 16, radius 16.
 */
import { router, useLocalSearchParams } from 'expo-router';
import { StyleSheet, View } from 'react-native';

import {
  AppText,
  Card,
  Footnote,
  Icon,
  ListRow,
  Screen,
  SectionHeader,
  SegmentedControl,
} from '@/components';
import { ImportRefusedSheet } from '@/features/groups/ImportRefusedSheet';
import { hrefs } from '@/features/groups/routes';
import { useImportGroupFile } from '@/features/groups/useImportGroupFile';
import { LINKS } from '@/features/settings/about';
import { useInAppBrowser } from '@/features/report/inAppBrowser';
import { NotificationsRow } from '@/features/settings/NotificationsRow';
import { YouCard } from '@/features/settings/YouCard';
import { usePrefs, type Appearance } from '@/state';
import { useTheme } from '@/theme';

const APPEARANCE = [
  { key: 'system', label: 'System' },
  { key: 'light', label: 'Light' },
  { key: 'dark', label: 'Dark' },
] as const;

export default function SettingsScreen() {
  const { tokens } = useTheme();
  const { prefs, setAppearance } = usePrefs();
  const { importGroupFile, busy, refused, openAnyway, dismissRefused } = useImportGroupFile();
  const openPage = useInAppBrowser();
  // Development builds only (the dev seed's screenshots): `y` scrolls the content by that many points.
  const { picker, y } = useLocalSearchParams<{ picker?: string; y?: string }>();
  const scrollY = __DEV__ && y !== undefined && Number.isFinite(Number(y)) ? Number(y) : undefined;

  const back = () => (router.canGoBack() ? router.back() : router.replace(hrefs.groups));

  return (
    <Screen
      back={{ label: 'Groups', onPress: back }}
      largeTitle="Settings"
      contentContainerStyle={
        scrollY === undefined ? undefined : { transform: [{ translateY: -scrollY }] }
      }
    >
      <SectionHeader variant="settings" spacingTop={16}>
        You
      </SectionHeader>
      <YouCard openPicker={__DEV__ && picker === 'emoji'} />
      <Footnote>Filled in when you create or join a group.</Footnote>

      <Card radius="group" style={styles.card}>
        <View style={styles.appearance}>
          <AppText variant="callout" style={styles.flex} nativeID="appearance-label">
            Appearance
          </AppText>
          <SegmentedControl<Appearance>
            size="compact"
            segments={APPEARANCE}
            value={prefs?.appearance ?? 'system'}
            onChange={(value) => void setAppearance(value)}
            accessibilityLabel="Appearance"
          />
        </View>
      </Card>

      <Card radius="group" style={styles.card}>
        <NotificationsRow />
      </Card>

      <SectionHeader variant="settings" spacingTop={16}>
        Groups
      </SectionHeader>
      <Card radius="group" style={styles.section}>
        <ListRow
          leading={<Icon name="import" size={20} color={tokens.accent} />}
          title="Import group file"
          titleColor="accent"
          titleWeight="medium"
          onPress={busy ? undefined : () => void importGroupFile()}
        />
      </Card>
      <Footnote>Opens a group from a .even file.</Footnote>

      <SectionHeader variant="settings" spacingTop={16}>
        Help
      </SectionHeader>
      <Card radius="group" style={styles.section}>
        <ListRow
          title="Help and feedback"
          chevron
          minHeight={48}
          onPress={() => void openPage(LINKS.contact)}
          accessibilityLabel="Help and feedback"
        />
      </Card>
      <Footnote>Opens our contact page. Nothing about your groups is sent.</Footnote>

      <Card radius="group" style={styles.card}>
        <ListRow title="About" chevron minHeight={48} onPress={() => router.push(hrefs.about)} />
      </Card>
      <ImportRefusedSheet
        refused={refused}
        busy={busy}
        onOpen={() => void openAnyway()}
        onDismiss={dismissRefused}
      />
    </Screen>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  card: { marginTop: 20, marginHorizontal: 16 },
  section: { marginHorizontal: 16 },
  appearance: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    minHeight: 56,
    paddingLeft: 16,
    paddingRight: 10,
  },
});
