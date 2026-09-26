/**
 * App settings (AppSettings, AppSettingsDark), pushed from the gear on Groups: "‹ Groups", the large title
 * "Settings", then You (avatar and Name), Appearance (System · Light · Dark), Notifications with its sentence,
 * Groups → Import group file, and About (Privacy, Terms, Source code, Version). No background-sync switch exists.
 *
 * Spacing as drawn: section headers 16 above and 6 below, inset 20; the Appearance and Notifications cards 20 below
 * what precedes them; footnotes 6 under their card; every card inset 16, radius 16.
 */
import Constants from 'expo-constants';
import { router, useLocalSearchParams } from 'expo-router';
import { Linking, StyleSheet, View } from 'react-native';

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
import { hrefs } from '@/features/groups/routes';
import { useImportGroupFile } from '@/features/groups/useImportGroupFile';
import { LINKS, versionLabel } from '@/features/settings/about';
import { NotificationsRow } from '@/features/settings/NotificationsRow';
import { YouCard } from '@/features/settings/YouCard';
import { usePrefs, type Appearance } from '@/state';
import { useTheme } from '@/theme';

const APPEARANCE = [
  { key: 'system', label: 'System' },
  { key: 'light', label: 'Light' },
  { key: 'dark', label: 'Dark' },
] as const;

const VERSION = versionLabel(
  Constants.expoConfig?.version,
  Constants.platform?.ios?.buildNumber ?? Constants.expoConfig?.ios?.buildNumber,
);

export default function SettingsScreen() {
  const { tokens } = useTheme();
  const { prefs, setAppearance } = usePrefs();
  const { importGroupFile, busy } = useImportGroupFile();
  const { picker } = useLocalSearchParams<{ picker?: string }>();

  const back = () => (router.canGoBack() ? router.back() : router.replace(hrefs.groups));

  return (
    <Screen back={{ label: 'Groups', onPress: back }} largeTitle="Settings">
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
      <Footnote>Your phone decides when Even can check for updates in the background.</Footnote>

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
      <Footnote>Restores a group from a .even file, even one this phone has never had.</Footnote>

      <SectionHeader variant="settings" spacingTop={16}>
        About
      </SectionHeader>
      <Card radius="group" separatorInset={16} style={styles.section}>
        <ListRow
          title="Privacy"
          chevron
          minHeight={48}
          onPress={() => void Linking.openURL(LINKS.privacy)}
        />
        <ListRow
          title="Terms"
          chevron
          minHeight={48}
          onPress={() => void Linking.openURL(LINKS.terms)}
        />
        <ListRow
          title="Source code"
          chevron
          minHeight={48}
          onPress={() => void Linking.openURL(LINKS.source)}
        />
        <ListRow title="Version" detail={VERSION} minHeight={48} paddingRight={16} />
      </Card>
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
