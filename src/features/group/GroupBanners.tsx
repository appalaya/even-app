import { router } from 'expo-router';
import type { ReactNode } from 'react';
import { Alert, Clipboard, Linking, StyleSheet, View } from 'react-native';

import { Banner, movedMessage } from '@/components';
import { useApp, type DerivedGroup } from '@/state';
import { layout } from '@/theme';

import { hostOf, movedBy } from './model';
import { groupHrefs } from './routes';

/** Where "Update" leads until the store listing exists: the landing page carries the store badges. */
const UPDATE_URL = 'https://even.appalaya.com';

/** Whether any banner shows (the header sits 4 pt closer under one: Group · dark). */
export function showsBanner(derived: DerivedGroup): boolean {
  return (
    derived.updateRequired ||
    derived.skipped.total > 0 ||
    derived.readOnly === 'closed' ||
    derived.readOnly === 'archived' ||
    (derived.moveOffer !== null && derived.state !== null)
  );
}

/**
 * The banners under Group's nav bar, each as its board draws it (Group · dark: unreadable entries; States: update
 * required, group closed, group moved; Group, archived). Hidden entries of a newer version already say "Update", so
 * the unreadable count stands aside while that banner shows.
 */
export function GroupBanners({ derived }: { derived: DerivedGroup }) {
  const { groups } = useApp();
  const { localId, state, skipped } = derived;
  const banners: ReactNode[] = [];

  if (derived.updateRequired) {
    banners.push(
      <Banner
        key="update"
        variant="updateRequired"
        onAction={() => void Linking.openURL(UPDATE_URL)}
      />,
    );
  } else if (skipped.total > 0) {
    banners.push(
      <Banner
        key="unreadable"
        variant="unreadable"
        message={`${skipped.total} ${skipped.total === 1 ? 'entry' : 'entries'} couldn't be read`}
        onAction={() => router.push(groupHrefs.settings(localId))}
      />,
    );
  }
  if (derived.readOnly === 'closed') {
    banners.push(
      <Banner
        key="closed"
        variant="closed"
        onAction={() => {
          void Clipboard.getString().then((text) =>
            router.push(groupHrefs.joinWithCode(text.trim())),
          );
        }}
      />,
    );
  } else if (derived.moveOffer !== null && state !== null) {
    const host = hostOf(derived.moveOffer);
    banners.push(
      <Banner
        key="moved"
        variant="moved"
        message={movedMessage(movedBy(state, derived.myMemberId), host)}
        onAction={() => {
          groups.followMove(localId).then(
            (result) => {
              if (result.outcome !== 'moved') {
                Alert.alert(`Couldn't move to ${host}`, 'Try again in a moment.');
              }
            },
            () => Alert.alert(`Couldn't move to ${host}`, 'Try again in a moment.'),
          );
        }}
      />,
    );
  }
  if (derived.readOnly === 'archived') {
    banners.push(
      <Banner
        key="archived"
        variant="archived"
        message="Archived · read-only"
        onAction={() => void groups.unarchiveGroup(localId)}
      />,
    );
  }
  if (banners.length === 0) return null;
  return <View style={styles.list}>{banners}</View>;
}

const styles = StyleSheet.create({
  list: { marginTop: 8, marginHorizontal: layout.gutter, gap: 8 },
});
