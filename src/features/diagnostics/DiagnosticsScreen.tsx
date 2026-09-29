/**
 * Diagnostics (AppDiagnostics, AppDiagnosticsDark; DiagnosticsStates for the empty table and the check's idle,
 * running and done states), pushed from About: "‹ About" with "Diagnostics" centred in the nav bar. Read-only apart
 * from "Check the model"; everything on it is already on the phone, and nothing here is sent anywhere.
 *
 * - Category model (iOS only): Status and Model (the availability asked when the page opens), then "Since Even
 *   opened", the last 20 outcomes of the chip's model (`useCategoryModelLog`; never a title), or the empty sentence.
 * - Check on this phone (iOS only): "Check the model" runs the bundled test titles through the model one at a time
 *   (`useModelCheck`): "Checking… 37 of 221" over a progress bar with the button off, then the score, the median
 *   time, and each category's right of total with a bar as on Balances. Off while the model is unavailable.
 * - Sync: per group, its name and unsent count, when it last synced, and the last error in Group's status line words.
 * - This build: version and build, the system version, the device, and Apple Intelligence. No device id: the page is
 *   meant to be screenshotted, and the id is the one value on it that is stable across groups and reinstalls, while
 *   nothing a tester or support has can be matched against it (the server never sees it).
 *
 * Android has no on-device model, so it leaves out both model sections (`diagnosticsSections`) and opens on Sync, or
 * This build with no groups; iOS is unchanged.
 *
 * Spacing as drawn: the first section header 16 above, the rest 24, 6 below; info rows 48 min, padded 6 16, the
 * label `textSecondary`; separators 1 pt inset 16; every card inset 16, radius 16; captions 6 under their card.
 */
import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useRef } from 'react';
import { Platform, StyleSheet, View } from 'react-native';

import {
  AppText,
  Button,
  Card,
  Footnote,
  Icon,
  Screen,
  SectionHeader,
  Separator,
} from '@/components';
import { useNow } from '@/features/group/hooks';
import { hrefs } from '@/features/groups/routes';
import { APP_VERSION } from '@/features/settings/appVersion';
import { useCategoryModelLog, useGroups, type GroupListRow } from '@/state';
import { installedOnDeviceModel, type ModelOutcomeEntry } from '@/state/categories';
import { layout, useTheme } from '@/theme';

import {
  appleIntelligence,
  categoryLabel,
  checkSummary,
  countOf,
  deviceLabel,
  diagnosticsSections,
  lastSyncedLabel,
  medianLine,
  modelLabel,
  modelName,
  modelStatus,
  NONE,
  outcomeLabel,
  percentOf,
  seconds,
  syncErrorLine,
  systemRow,
  unsentLabel,
  type DiagnosticsSection,
  type PlatformFacts,
} from './format';
import { useModelAvailability, useModelCheck, type ModelCheckState } from './hooks';
import type { ModelCheckResult } from './modelCheck';

const PLATFORM: PlatformFacts = {
  os: Platform.OS,
  version: Platform.Version,
  constants: Platform.constants as unknown as Record<string, unknown>,
};

export function DiagnosticsScreen() {
  const availability = useModelAvailability();
  const known = availability !== undefined;
  const outcomes = useCategoryModelLog();
  const { rows } = useGroups();
  const now = useNow();
  const { state: check, start } = useModelCheck(installedOnDeviceModel());
  const canCheck = availability?.status === 'available';

  // Development builds only (the dev seed's screenshots): `y` scrolls the content by that many points, and
  // `check=1` starts the check once the model is known to be there.
  const params = useLocalSearchParams<{ y?: string; check?: string }>();
  const scrollY =
    __DEV__ && params.y !== undefined && Number.isFinite(Number(params.y))
      ? Number(params.y)
      : undefined;
  const autoStarted = useRef(false);
  useEffect(() => {
    if (!__DEV__ || params.check !== '1' || !canCheck || autoStarted.current) return;
    autoStarted.current = true;
    start();
  }, [params.check, canCheck, start]);

  const back = () => (router.canGoBack() ? router.back() : router.replace(hrefs.about));
  const system = systemRow(PLATFORM);
  const sections = diagnosticsSections(PLATFORM.os, rows.length);
  const shows = (section: DiagnosticsSection) => sections.includes(section);
  // The first section header sits 16 below the nav bar, the rest 24 (their default).
  const spacingTop = (section: DiagnosticsSection) => (section === sections[0] ? 16 : undefined);

  return (
    <Screen
      back={{ label: 'About', onPress: back }}
      title="Diagnostics"
      contentContainerStyle={
        scrollY === undefined ? undefined : { transform: [{ translateY: -scrollY }] }
      }
    >
      {shows('model') && (
        <>
          <SectionHeader variant="settings" spacingTop={spacingTop('model')}>
            Category model
          </SectionHeader>
          <Card radius="group" style={styles.card}>
            <InfoRow label="Status" value={known ? modelStatus(availability) : ''} />
            <Separator inset={16} />
            <InfoRow label="Model" value={known ? modelName(availability) : ''} />
            <Separator inset={16} />
            <AppText
              variant="caption"
              color="textSecondary"
              weight="semibold"
              accessibilityRole="header"
              style={styles.tableTitle}
            >
              Since Even opened
            </AppText>
            {outcomes.length === 0 ? (
              <AppText variant="subheadLoose" color="textSecondary" style={styles.empty}>
                Nothing yet. The model runs when a title doesn&apos;t match a keyword.
              </AppText>
            ) : (
              <OutcomesTable entries={outcomes} />
            )}
          </Card>
          <Footnote>Only outcomes are kept, never titles.</Footnote>
        </>
      )}

      {shows('check') && (
        <>
          <SectionHeader variant="settings" spacingTop={spacingTop('check')}>
            Check on this phone
          </SectionHeader>
          <Card radius="group" style={styles.card}>
            <CheckCard state={check} enabled={canCheck} onStart={start} />
          </Card>
          <Footnote>
            Runs the app&apos;s built-in test titles on this phone&apos;s model. About a minute.
            Nothing leaves the phone.
          </Footnote>
        </>
      )}

      {shows('sync') && (
        <>
          <SectionHeader variant="settings" spacingTop={spacingTop('sync')}>
            Sync
          </SectionHeader>
          <Card radius="group" separatorInset={16} style={styles.card}>
            {rows.map((row) => (
              <SyncRow key={row.localId} row={row} now={now} />
            ))}
          </Card>
        </>
      )}

      <SectionHeader variant="settings" spacingTop={spacingTop('build')}>
        This build
      </SectionHeader>
      <Card radius="group" separatorInset={16} style={styles.card}>
        <InfoRow label="Version" value={APP_VERSION} />
        <InfoRow label={system.label} value={system.value} />
        <InfoRow label="Device" value={deviceLabel(PLATFORM)} />
        {Platform.OS === 'ios' && (
          <InfoRow
            label="Apple Intelligence"
            value={known ? appleIntelligence(availability) : ''}
          />
        )}
      </Card>
    </Screen>
  );
}

/** A label in `textSecondary` and its value at the trailing edge (Status, Model, This build). */
function InfoRow({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.infoRow} accessible accessibilityLabel={`${label}, ${value}`}>
      <AppText variant="callout" color="textSecondary" style={styles.infoLabel}>
        {label}
      </AppText>
      <AppText variant="callout" tabular align="right" style={styles.infoValue}>
        {value}
      </AppText>
    </View>
  );
}

/** "Since Even opened": the column heads, then one row per outcome, newest first. */
function OutcomesTable({ entries }: { entries: readonly ModelOutcomeEntry[] }) {
  return (
    <View>
      <View
        style={styles.outcomeHead}
        accessibilityElementsHidden
        importantForAccessibility="no-hide-descendants"
      >
        <AppText variant="caption" color="textMuted" style={styles.colOutcome}>
          Outcome
        </AppText>
        <AppText variant="caption" color="textMuted" style={styles.colCategory}>
          Category
        </AppText>
        <AppText variant="caption" color="textMuted" align="right" style={styles.colTime}>
          Time
        </AppText>
        <AppText variant="caption" color="textMuted" align="right" style={styles.colModel}>
          Model
        </AppText>
      </View>
      <View style={styles.outcomeRows}>
        {entries.map((entry) => (
          <OutcomeRow key={`${entry.at}-${entry.ms}-${entry.outcome}`} entry={entry} />
        ))}
      </View>
    </View>
  );
}

function OutcomeRow({ entry }: { entry: ModelOutcomeEntry }) {
  const category = entry.category === null ? null : categoryLabel(entry.category);
  const model = modelLabel(entry.model);
  return (
    <View
      style={styles.outcomeRow}
      accessible
      accessibilityLabel={[
        outcomeLabel(entry.outcome),
        category ?? 'no category',
        seconds(entry.ms),
        entry.model === null ? 'no model' : model,
      ].join(', ')}
    >
      <AppText variant="subhead" weight="medium" style={styles.colOutcome}>
        {outcomeLabel(entry.outcome)}
      </AppText>
      <AppText
        variant="subhead"
        color={category === null ? 'textMuted' : 'textSecondary'}
        numberOfLines={1}
        style={styles.colCategory}
      >
        {category ?? NONE}
      </AppText>
      <AppText variant="subhead" color="textSecondary" tabular align="right" style={styles.colTime}>
        {seconds(entry.ms)}
      </AppText>
      <AppText variant="caption" color="textMuted" align="right" style={styles.colModel}>
        {model}
      </AppText>
    </View>
  );
}

/** Check on this phone: the button (idle), the progress (running), or the results over the button (done). */
function CheckCard({
  state,
  enabled,
  onStart,
}: {
  state: ModelCheckState;
  enabled: boolean;
  onStart: () => void;
}) {
  const running = state.phase === 'running';
  const button = (
    <Button
      label="Check the model"
      size="medium"
      disabled={running || !enabled}
      onPress={onStart}
    />
  );
  if (state.phase === 'running') {
    return (
      <View style={styles.checkRunning}>
        <View style={styles.progressLine} accessibilityRole="text" accessibilityLiveRegion="polite">
          <AppText variant="subhead">Checking…</AppText>
          <AppText variant="subhead" color="textSecondary" tabular>
            {countOf(state.done, state.total)}
          </AppText>
        </View>
        <Bar
          share={state.total > 0 ? state.done / state.total : 0}
          tone="accent"
          accessibilityLabel="Checking the model"
          progress={{ now: state.done, max: state.total }}
        />
        {button}
      </View>
    );
  }
  if (state.phase === 'done') {
    return (
      <>
        <CheckResults result={state.result} />
        <View style={styles.checkAgain}>{button}</View>
      </>
    );
  }
  return <View style={styles.checkIdle}>{button}</View>;
}

function CheckResults({ result }: { result: ModelCheckResult }) {
  return (
    <>
      <View style={styles.summary} accessibilityLiveRegion="polite">
        <AppText variant="body" weight="semibold" tabular>
          {checkSummary(result.right, result.total)}
        </AppText>
        <AppText variant="caption" color="textMuted" tabular>
          {medianLine(result.medianMs)}
        </AppText>
      </View>
      <View style={styles.scoreRows}>
        {result.byCategory.map((score) => {
          const percent = percentOf(score.right, score.total);
          return (
            <View
              key={score.category}
              style={styles.scoreRow}
              accessible
              accessibilityLabel={`${categoryLabel(score.category)}, ${countOf(score.right, score.total)}, ${percent} percent`}
            >
              <AppText variant="subhead" numberOfLines={1} style={styles.flex}>
                {categoryLabel(score.category)}
              </AppText>
              <AppText
                variant="subhead"
                color="textSecondary"
                tabular
                align="right"
                style={styles.scoreCount}
              >
                {countOf(score.right, score.total)}
              </AppText>
              <View style={styles.scoreBar}>
                <Bar share={score.total > 0 ? score.right / score.total : 0} tone="bar" />
              </View>
              <AppText
                variant="caption"
                color="textMuted"
                tabular
                align="right"
                style={styles.scorePercent}
              >
                {`${percent}%`}
              </AppText>
            </View>
          );
        })}
      </View>
    </>
  );
}

/** A 6 pt bar (radius 3) on `barTrack`: the accent for progress, `accentBar` for a score (as on Balances). */
function Bar({
  share,
  tone,
  accessibilityLabel,
  progress,
}: {
  share: number;
  tone: 'accent' | 'bar';
  accessibilityLabel?: string;
  progress?: { now: number; max: number };
}) {
  const { tokens } = useTheme();
  const width = `${Math.min(1, Math.max(0, share)) * 100}%` as const;
  return (
    <View
      style={[styles.track, { backgroundColor: tokens.barTrack }]}
      accessibilityRole={progress === undefined ? undefined : 'progressbar'}
      accessibilityLabel={accessibilityLabel}
      accessibilityValue={
        progress === undefined ? undefined : { min: 0, max: progress.max, now: progress.now }
      }
      accessibilityElementsHidden={progress === undefined}
      importantForAccessibility={progress === undefined ? 'no-hide-descendants' : 'auto'}
    >
      <View
        style={[
          styles.fill,
          { width, backgroundColor: tone === 'accent' ? tokens.accent : tokens.accentBar },
        ]}
      />
    </View>
  );
}

/** One group: name and unsent count, when it last synced, and its last error in Group's status line words. */
function SyncRow({ row, now }: { row: GroupListRow; now: number }) {
  const { tokens } = useTheme();
  const synced = lastSyncedLabel(row.sync.lastSyncedAt, now);
  const error = syncErrorLine(row.sync, now);
  return (
    <View
      style={styles.syncRow}
      accessible
      accessibilityLabel={[row.name, unsentLabel(row.outbox), synced, error]
        .filter((part) => part !== null)
        .join(', ')}
    >
      <View style={styles.syncTop}>
        <AppText variant="callout" weight="medium" style={styles.flexShrink}>
          {row.name}
        </AppText>
        <AppText variant="subhead" color="textSecondary" tabular>
          {unsentLabel(row.outbox)}
        </AppText>
      </View>
      <AppText variant="caption" color="textMuted">
        {synced}
      </AppText>
      {error !== null && (
        <View style={styles.syncError}>
          <View style={styles.syncErrorGlyph}>
            <Icon name="warning" size={13} color={tokens.text} strokeWidth={2.2} />
          </View>
          <AppText variant="caption" weight="semibold" style={styles.flexShrink}>
            {error}
          </AppText>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1, minWidth: 0 },
  flexShrink: { flexShrink: 1 },
  card: { marginHorizontal: layout.gutter },
  infoRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 16,
    minHeight: 48,
    paddingVertical: 6,
    paddingHorizontal: 16,
  },
  infoLabel: { flexShrink: 0 },
  infoValue: { flexShrink: 1 },
  tableTitle: { paddingTop: 12, paddingHorizontal: 16, paddingBottom: 4 },
  empty: { paddingTop: 4, paddingHorizontal: 16, paddingBottom: 16 },
  outcomeHead: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    minHeight: 24,
    paddingHorizontal: 16,
  },
  outcomeRows: { paddingBottom: 6 },
  outcomeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    minHeight: 44,
    paddingHorizontal: 16,
  },
  colOutcome: { width: 92 },
  colCategory: { flex: 1, minWidth: 0 },
  colTime: { width: 48 },
  colModel: { width: 60 },
  checkIdle: { padding: 16 },
  checkRunning: { padding: 16, gap: 10 },
  checkAgain: { paddingTop: 8, paddingHorizontal: 16, paddingBottom: 16 },
  progressLine: { flexDirection: 'row', justifyContent: 'space-between' },
  summary: { paddingTop: 16, paddingHorizontal: 16, paddingBottom: 8, gap: 2 },
  scoreRows: { paddingBottom: 8 },
  scoreRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    minHeight: 36,
    paddingHorizontal: 16,
  },
  scoreCount: { width: 64 },
  scoreBar: { width: 72 },
  scorePercent: { width: 40 },
  track: { height: 6, borderRadius: 3, overflow: 'hidden' },
  fill: { height: 6, borderRadius: 3 },
  syncRow: { paddingVertical: 12, paddingHorizontal: 16, gap: 2 },
  syncTop: { flexDirection: 'row', justifyContent: 'space-between', gap: 12 },
  syncError: { flexDirection: 'row', alignItems: 'flex-start', gap: 6, marginTop: 2 },
  syncErrorGlyph: { paddingTop: 2 },
});
