/**
 * Groups (Main, GroupsDark; GroupsEmpty, GroupsEmptyDark): the app's first screen. Group cards in `useGroups()`
 * order, the collapsed "Archived · N" row, "Import group file", and the sticky "Join with code" · "Create group"
 * footer; with no groups, the wordmark header and the empty state's mark and motion. On a first launch with an
 * empty store and groups left in the keychain, a sheet offers to recover them.
 */
import { router, useLocalSearchParams } from 'expo-router';
import { Pressable, StyleSheet, View } from 'react-native';

import { AppText, Button, HeaderButton, Screen, Wordmark } from '@/components';
import { ArchivedSection } from '@/features/groups/ArchivedSection';
import { GroupCard } from '@/features/groups/GroupCard';
import { GroupsEmpty } from '@/features/groups/GroupsEmpty';
import { ImportGroupFileButton } from '@/features/groups/ImportGroupFileButton';
import { hrefs } from '@/features/groups/routes';
import { useImportGroupFile } from '@/features/groups/useImportGroupFile';
import { useKeychainRecovery } from '@/features/groups/useKeychainRecovery';
import { ConfirmSheet } from '@/features/join/ConfirmSheet';
import { recoverQuestion } from '@/features/join/invite';
import { useGroups } from '@/state';

/** Dev only: long-press the title to open the UI kit gallery. */
const openKit = __DEV__ ? () => router.push('/dev/kit') : undefined;

export default function GroupsScreen() {
  const list = useGroups();
  const params = useLocalSearchParams<{ motionAt?: string; archived?: string }>();
  const recovery = useKeychainRecovery();
  const { importGroupFile, busy } = useImportGroupFile();

  const settings = (
    <HeaderButton
      icon="gear"
      size={24}
      accessibilityLabel="Settings"
      onPress={() => router.push(hrefs.settings)}
    />
  );
  const open = (localId: string) => router.push(hrefs.group(localId));
  const create = () => router.push(hrefs.create);
  const join = () => router.push(hrefs.join);

  const recoverySheet = (
    <ConfirmSheet
      visible={recovery.offer > 0}
      onDismiss={recovery.dismiss}
      question={recoverQuestion(recovery.offer)}
      confirmLabel="Recover"
      onConfirm={() => void recovery.recover()}
      cancelLabel="Not now"
      busy={recovery.busy}
    />
  );

  // A few milliseconds on open: nothing, rather than a header that may be the wrong one.
  if (list.status === 'loading') return <Screen scroll={false}>{null}</Screen>;

  if (list.rows.length === 0) {
    const motionAt = __DEV__ && params.motionAt !== undefined ? Number(params.motionAt) : undefined;
    return (
      <Screen
        largeTitle={
          <Pressable onLongPress={openKit} accessible={false}>
            <Wordmark />
          </Pressable>
        }
        headerRight={settings}
        scroll={false}
      >
        <GroupsEmpty onCreate={create} onJoin={join} motionAt={motionAt} />
        {recoverySheet}
      </Screen>
    );
  }

  const active = list.rows.filter((row) => !row.archived);
  const archived = list.rows.filter((row) => row.archived);

  return (
    <Screen
      largeTitle={<Title />}
      headerRight={settings}
      footer={
        <View style={styles.footer}>
          <View style={styles.half}>
            <Button label="Join with code" variant="secondary" onPress={join} />
          </View>
          <View style={styles.half}>
            <Button label="Create group" onPress={create} />
          </View>
        </View>
      }
    >
      <View accessibilityLabel="Your groups" style={styles.list}>
        {active.map((row) => (
          <GroupCard key={row.localId} row={row} onPress={() => open(row.localId)} />
        ))}
      </View>
      <ArchivedSection
        rows={archived}
        onOpen={open}
        initiallyOpen={__DEV__ && params.archived === 'open'}
      />
      <ImportGroupFileButton onPress={() => void importGroupFile()} disabled={busy} />
      {recoverySheet}
    </Screen>
  );
}

function Title() {
  return (
    <AppText variant="largeTitle" accessibilityRole="header" onLongPress={openKit}>
      Groups
    </AppText>
  );
}

const styles = StyleSheet.create({
  list: { gap: 10, paddingHorizontal: 16 },
  footer: { flexDirection: 'row', gap: 10 },
  half: { flex: 1 },
});
