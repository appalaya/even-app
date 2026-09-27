/**
 * "Report this group" (ReportGroup, ReportGroupOther boards), from the last row of Group settings.
 *
 * On the server Appalaya runs: "Report Banff 2026?", what the contact page will be given (the group's id, its
 * server, and the reason the person writes there), what a block does, then "Continue to report" and Cancel.
 *
 * On any other server (compared canonically: contact.ts, `isAppalayaServer`): the same question, that server named
 * as the one only its operator can act on, "This server" with its host and, when its `/v1/info` sends them, its
 * operator and terms (the terms open in the in-app browser); then "Tell Appalaya anyway", demoted to `fill`, and
 * Cancel.
 *
 * Either button opens the contact page in the in-app browser with the group in the URL's fragment (contact.ts,
 * `reportUrl`), once this sheet has gone (ReportInBrowser: "Done" there lands back on Group settings).
 */
import { useEffect, useRef, useState } from 'react';
import { Pressable, StyleSheet, useWindowDimensions, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { AppText, Button, Card, Icon, Separator, Sheet } from '@/components';
import { hostOf } from '@/features/groupSettings/model';
import { monoFamily, radii, useTheme } from '@/theme';
import { useApp, type ReportInfo } from '../../state';
import type { ServerInfo } from '../../services/sync/types';

import { isAppalayaServer, reportUrl, serverDetails, shortGroupId } from './contact';
import { useInAppBrowser } from './inAppBrowser';

/** The sheet's top edge on the 874 pt boards: ReportGroup 292, ReportGroupOther 250. */
const DRAWN_TOP = { appalaya: 292, other: 250 } as const;
const BOARD_HEIGHT = 874;
/**
 * The browser opens once the sheet is gone: its slide-out (220 ms) and the modal's dismissal. A browser presented
 * while the sheet's modal is still up would be dismissed with it.
 */
const BROWSER_AFTER_SHEET_MS = 400;

export interface ReportGroupSheetProps {
  visible: boolean;
  groupName: string;
  /** From `groups.reportInfo`: the group's id on its server and that server. Read before the sheet opens. */
  report: ReportInfo | null;
  onDismiss: () => void;
}

export function ReportGroupSheet({ visible, groupName, report, onDismiss }: ReportGroupSheetProps) {
  const insets = useSafeAreaInsets();
  const { height } = useWindowDimensions();
  const { groups } = useApp();
  const openPage = useInAppBrowser();
  const server = report?.server ?? null;
  const appalaya = server !== null && isAppalayaServer(server);
  // Kept with the server it describes, so a group moved since cannot show the old server's.
  const [read, setRead] = useState<{ server: string; info: ServerInfo | null } | null>(null);
  const info = read !== null && read.server === server ? read.info : undefined;
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // The other server's operator and terms: its `/v1/info`, from the cache Group settings' Server card fills.
  useEffect(() => {
    if (!visible || server === null || appalaya) return;
    let live = true;
    void groups.serverInfo(server).then((value) => {
      if (live) setRead({ server, info: value });
    });
    return () => {
      live = false;
    };
  }, [visible, server, appalaya, groups]);

  useEffect(
    () => () => {
      if (timer.current !== null) clearTimeout(timer.current);
    },
    [],
  );

  const continueToReport = () => {
    if (report === null) return;
    const url = reportUrl(report);
    onDismiss();
    timer.current = setTimeout(() => void openPage(url), BROWSER_AFTER_SHEET_MS);
  };

  const drawnTop = appalaya ? DRAWN_TOP.appalaya : DRAWN_TOP.other;
  return (
    <Sheet
      visible={visible}
      onDismiss={onDismiss}
      top={Math.max(insets.top + 48, height - (BOARD_HEIGHT - drawnTop))}
      accessibilityLabel={`Report ${groupName}?`}
    >
      {report !== null && (
        <View style={styles.body}>
          <AppText variant="title3" accessibilityRole="header" style={styles.title}>
            {`Report ${groupName}?`}
          </AppText>
          {appalaya ? (
            <AppalayaBody report={report} />
          ) : (
            <OtherBody
              groupName={groupName}
              report={report}
              info={info}
              onOpenTerms={(url) => void openPage(url)}
            />
          )}
          <View style={styles.flex} />
          <Button
            label={appalaya ? 'Continue to report' : 'Tell Appalaya anyway'}
            variant={appalaya ? 'primary' : 'neutral'}
            labelColor={appalaya ? undefined : 'accent'}
            onPress={continueToReport}
            style={styles.primary}
          />
          <Button label="Cancel" variant="neutral" onPress={onDismiss} style={styles.cancel} />
        </View>
      )}
    </Sheet>
  );
}

/** ReportGroup: "What we receive" and what a block does. */
function AppalayaBody({ report }: { report: ReportInfo }) {
  return (
    <>
      <AppText variant="calloutLoose" color="textSecondary" style={styles.paragraph}>
        This opens our contact page with the group filled in. You add what&apos;s wrong.
      </AppText>
      <Card tone="fill" radius="group" style={styles.box}>
        <BoxHeader>What we receive</BoxHeader>
        <Row
          label="Group id"
          value={shortGroupId(report.groupId)}
          mono
          accessibilityValue={report.groupId}
        />
        <Separator inset={16} tone="inset" />
        <Row label="Server" value={hostOf(report.server)} />
        <Separator inset={16} tone="inset" />
        <Row label="Reason" value="What you write" />
      </Card>
      <AppText variant="footnote" color="textSecondary" style={styles.note}>
        Never the invite, the key, or anything in the group. If we block it, it stops syncing on our
        server for everyone; copies on phones stay.
      </AppText>
    </>
  );
}

/** ReportGroupOther: the server that can act on it, and what telling Appalaya still does. */
function OtherBody({
  groupName,
  report,
  info,
  onOpenTerms,
}: {
  groupName: string;
  report: ReportInfo;
  info: ServerInfo | null | undefined;
  onOpenTerms: (url: string) => void;
}) {
  const { tokens } = useTheme();
  const host = hostOf(report.server);
  const { operator, terms } = serverDetails(info);
  return (
    <>
      <AppText variant="calloutLoose" color="textSecondary" style={styles.paragraph}>
        {`${groupName} is on ${host}, which Appalaya doesn't run. Only that server's operator can block or remove it.`}
      </AppText>
      <Card tone="fill" radius="group" style={styles.box}>
        <BoxHeader>This server</BoxHeader>
        <Row label="Server" value={host} />
        {operator !== null && <Separator inset={16} tone="inset" />}
        {operator !== null && <Row label="Operator" value={operator} />}
        {terms !== null && <Separator inset={16} tone="inset" />}
        {terms !== null && (
          <Pressable
            onPress={() => onOpenTerms(terms.url)}
            accessibilityRole="link"
            accessibilityLabel={`Terms: ${terms.label}`}
            style={({ pressed }) => [
              styles.row,
              styles.linkRow,
              pressed && { backgroundColor: tokens.fillPressed },
            ]}
          >
            <AppText variant="subhead" color="textSecondary" style={styles.label}>
              Terms
            </AppText>
            <AppText
              variant="subhead"
              color="accent"
              align="right"
              numberOfLines={1}
              ellipsizeMode="middle"
              style={styles.value}
            >
              {terms.label}
            </AppText>
            <Icon name="chevronRight" size={16} color={tokens.iconMuted} />
          </Pressable>
        )}
      </Card>
      <AppText variant="footnote" color="textSecondary" style={styles.note}>
        You can still tell us. We&apos;ll read it, but we can&apos;t block this group or see inside
        it. We&apos;d get its id and server, never its key or contents.
      </AppText>
    </>
  );
}

function BoxHeader({ children }: { children: string }) {
  return (
    <AppText
      variant="caption"
      color="textSecondary"
      weight="semibold"
      accessibilityRole="header"
      style={styles.boxHeader}
    >
      {children}
    </AppText>
  );
}

function Row({
  label,
  value,
  mono = false,
  accessibilityValue,
}: {
  label: string;
  value: string;
  mono?: boolean;
  /** Spoken instead of `value` (the whole group id rather than its ends). */
  accessibilityValue?: string;
}) {
  return (
    <View
      style={styles.row}
      accessible
      accessibilityLabel={`${label}: ${accessibilityValue ?? value}`}
    >
      <AppText variant="subhead" color="textSecondary" style={styles.label}>
        {label}
      </AppText>
      <AppText variant="subhead" align="right" style={[styles.value, mono && styles.mono]}>
        {value}
      </AppText>
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  body: { flex: 1, paddingHorizontal: 16 },
  title: { marginTop: 22, marginHorizontal: 4 },
  paragraph: { marginTop: 10, marginHorizontal: 4 },
  box: { marginTop: 16, paddingBottom: 4, borderRadius: radii.group },
  boxHeader: { paddingTop: 12, paddingBottom: 2, paddingHorizontal: 16 },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    minHeight: 44,
    paddingHorizontal: 16,
  },
  linkRow: { paddingRight: 12 },
  label: { width: 72, flexShrink: 0 },
  value: { flex: 1 },
  /** The group id: 15/20 in the monospaced face, as drawn. */
  mono: { fontFamily: monoFamily },
  /** 14/20, as drawn. */
  note: { marginTop: 12, marginHorizontal: 4, lineHeight: 20 },
  primary: { marginTop: 20 },
  cancel: { marginTop: 10 },
});
