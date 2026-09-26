import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useMemo, useState } from 'react';
import { LogBox, StyleSheet } from 'react-native';

import { AppText, Screen } from '@/components';
import { buildScenario, flaggedPreview, SEED_STATES, seedGroup, type SeedState } from '@/dev/seedB';
import { ExpenseDetailView } from '@/features/expense/ExpenseDetailView';
import { flagOf } from '@/features/expense/model';
import { EnsureAppServices } from '@/features/group/EnsureAppServices';
import { useNow } from '@/features/group/hooks';
import { shareInvite } from '@/features/group/InviteCard';
import { groupHrefs } from '@/features/group/routes';
import { useApp } from '@/state';
import { layout } from '@/theme';

/**
 * Dev entry for stack B: seeds the canvas's sample group for `?state=` and opens it
 * (`com.appalaya.even://dev/seed-b?state=even`). States: group, balances, activity, unreadable, syncing, stale, update,
 * closed, moved, alldone, even, archived, many, done-sheet, new, invite, share, expense, and flagged (rendered in place: a
 * split that does not add up cannot pass validation, so it is not written to the store).
 */
export default function SeedB() {
  const { state } = useLocalSearchParams<{ state?: string }>();
  if (state === 'flagged') return <FlaggedPreview />;
  return (
    <EnsureAppServices>
      <Seeder state={SEED_STATES.find((s) => s === state) ?? 'group'} />
    </EnsureAppServices>
  );
}

function Seeder({ state }: { state: SeedState }) {
  const services = useApp();
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    // Screenshots are compared with the boards: keep dev toasts (library deprecation warnings) off them.
    LogBox.ignoreAllLogs(true);
    let cancelled = false;
    const spec = buildScenario(state, services.deviceId, Date.now());
    seedGroup(services, spec).then(
      (localId) => {
        if (cancelled) return;
        const { tab, stuck, sheet, expenseId } = spec.open;
        if (expenseId !== undefined) {
          router.replace(groupHrefs.expense(localId, expenseId));
          return;
        }
        const query = [tab && `tab=${tab}`, stuck && 'stuck=1', sheet && `sheet=${sheet}`]
          .filter(Boolean)
          .join('&');
        router.replace(
          `${groupHrefs.group(localId) as string}${query ? `?${query}` : ''}` as never,
        );
        if (spec.syncOnOpen) setTimeout(() => void services.groups.sync(localId, 'manual'), 600);
        if (spec.shareOnOpen) {
          setTimeout(() => {
            void services.groups
              .inviteFor(localId)
              .then((invite) => shareInvite(invite, spec.name));
          }, 1500);
        }
      },
      (reason: unknown) => {
        if (!cancelled) setError(reason instanceof Error ? reason.message : String(reason));
      },
    );
    return () => {
      cancelled = true;
    };
  }, [services, state]);
  return (
    <Screen largeTitle="Seed B">
      <AppText color="textSecondary" style={styles.note}>
        {error ?? `Seeding “${state}”…`}
      </AppText>
    </Screen>
  );
}

function FlaggedPreview() {
  const preview = useMemo(() => flaggedPreview('seedPreviewDeviceAAAAA'), []);
  const now = useNow();
  const expense = preview.state.expenses.get(preview.dinnerId);
  if (expense === undefined) return null;
  return (
    <ExpenseDetailView
      groupName="Banff 2026"
      state={preview.state}
      expense={expense}
      myId={preview.myMemberId}
      writable
      flag={flagOf(preview.state, preview.dinnerId)}
      now={now}
      onBack={() => (router.canGoBack() ? router.back() : router.replace(groupHrefs.groups))}
      onEdit={() => undefined}
      onDelete={() => undefined}
      onRestore={() => undefined}
    />
  );
}

const styles = StyleSheet.create({
  note: { marginHorizontal: layout.textInset },
});
