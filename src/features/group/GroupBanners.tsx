import { router } from 'expo-router';
import type { ReactNode } from 'react';
import * as Clipboard from 'expo-clipboard';
import { Alert, Linking, StyleSheet, View, Platform } from 'react-native';

import { Banner, collisionMessage, movedMessage } from '@/components';
import { useApp, type DerivedGroup } from '@/state';
import { layout } from '@/theme';

import { hostOf, movedBy } from './model';
import { groupHrefs } from './routes';
import { LINKS } from '@/features/settings/about';

/** "Update" opens this phone's store listing. */
const UPDATE_URL = Platform.OS === 'android' ? LINKS.store.android : LINKS.store.ios;

/**
 * Two or more non-archived members share a name (the reducer's `nameCollisions`): the first such name and how many
 * share it, for "Two members are named Maya. Rename one in settings." (Group screen copy).
 */
export function collisionOf(derived: DerivedGroup): { name: string; count: number } | null {
  const state = derived.state;
  const first = state?.nameCollisions[0];
  if (state == null || first === undefined || first.length < 2) return null;
  const name = state.members.get(first[0] ?? '')?.name ?? '';
  return name === '' ? null : { name, count: first.length };
}

/**
 * Whether the last banner is one of Group's flush ones (the header sits 4 pt closer under it: Group · dark, "2 entries
 * couldn't be read"). Under the padded banners (States; Group screen copy) the header keeps its 18.
 */
export function lastBannerFlush(derived: DerivedGroup): boolean {
  const padded =
    derived.readOnly === 'closed' ||
    (derived.moveOffer !== null && derived.state !== null) ||
    collisionOf(derived) !== null;
  if (derived.readOnly === 'archived') return true;
  return !padded && !derived.updateRequired && derived.skipped.total > 0;
}

/**
 * The banners under Group's nav bar, each as its board draws it (Group · dark: unreadable entries; States: update
 * required, group closed, group moved; Group, archived; Group screen copy: two members with one name, a closed
 * group). Hidden entries of a newer version already say "Update", so the unreadable count stands aside while that
 * banner shows.
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
          void Clipboard.getStringAsync().then((text) =>
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
  const collision = collisionOf(derived);
  if (collision !== null && derived.readOnly !== 'closed') {
    banners.push(
      <Banner
        key="collision"
        variant="collision"
        message={collisionMessage(collision.name, collision.count)}
        onAction={() => router.push(groupHrefs.settings(localId))}
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
