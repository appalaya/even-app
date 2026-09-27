import { StyleSheet, View } from 'react-native';

import { AppText, Button, Card, Footnote, Icon, ListRow } from '@/components';
import { layout, radii, useTheme } from '@/theme';
import type { UsageReport } from '../../state';

import {
  hostOf,
  limitsLabel,
  meterFill,
  operatorLabel,
  retentionLabel,
  usageLabel,
  usagePercent,
  usageWarning,
} from './model';

export interface ServerCardProps {
  serverUrl: string;
  /** The server's `/v1/info` and this group's usage; null or undefined while unknown. */
  report: UsageReport | null | undefined;
  /** The server this group was moved away from in this session: offer to delete the copy there. */
  oldServer: string | null;
  /** How long the old server keeps a group without writes, when known ("after 365 days"). */
  oldRetentionDays: number | null;
  readOnly: boolean;
  onMove: () => void;
  onDeleteOldCopy: () => void;
  /** "Export group file" under the usage warning. */
  onExportGroupFile: () => void;
}

/**
 * Group settings → Server (GroupSettings board): Host, Operator ("Self-hosted" when the server names none), Limits
 * and Keeps as 48 pt rows (label 80 wide in `textSecondary`, value right-aligned), the usage meter (8 pt, accent on
 * `barTrack`), then "Move to another server" in the accent. Rows the server's info would fill are left out until it
 * is known.
 *
 * Extra states: from 80 % the figure and the bar turn to the text colour (never red), with the warning line and
 * "Export group file"; after a move, "Delete the copy on <old host>" in `danger` with the trash glyph, and the
 * footnote "Moved from <old host>. The old copy there expires after 365 days." (the old server's retention; "expires
 * on its own" while that is unknown).
 */
export function ServerCard({
  serverUrl,
  report,
  oldServer,
  oldRetentionDays,
  readOnly,
  onMove,
  onDeleteOldCopy,
  onExportGroupFile,
}: ServerCardProps) {
  const { tokens } = useTheme();
  const info = report?.info;
  return (
    <>
      <Card radius="group" separatorInset={16} style={styles.card} accessibilityLabel="Server">
        <InfoRow label="Host" value={hostOf(serverUrl)} />
        {info !== undefined && <InfoRow label="Operator" value={operatorLabel(info)} />}
        {info !== undefined && <InfoRow label="Limits" value={limitsLabel(info)} tabular />}
        {info !== undefined && (
          <InfoRow label="Keeps" value={retentionLabel(info.retention_days)} />
        )}
        {report != null && <UsageMeter report={report} onExportGroupFile={onExportGroupFile} />}
        {!readOnly && (
          <ListRow
            title="Move to another server"
            titleColor="accent"
            titleWeight="medium"
            chevron="accent"
            onPress={onMove}
          />
        )}
        {oldServer !== null && (
          <ListRow
            leading={<Icon name="trash" size={18} color={tokens.danger} />}
            title={`Delete the copy on ${hostOf(oldServer)}`}
            titleColor="danger"
            titleWeight="medium"
            onPress={onDeleteOldCopy}
          />
        )}
      </Card>
      {oldServer !== null && (
        <Footnote>
          {`Moved from ${hostOf(oldServer)}. The old copy there expires ${
            oldRetentionDays === null ? 'on its own' : `after ${oldRetentionDays} days`
          }.`}
        </Footnote>
      )}
    </>
  );
}

function InfoRow({ label, value, tabular }: { label: string; value: string; tabular?: boolean }) {
  return (
    <View style={styles.infoRow} accessible accessibilityLabel={`${label}: ${value}`}>
      <AppText variant="callout" color="textSecondary" style={styles.label}>
        {label}
      </AppText>
      <AppText variant="callout" align="right" tabular={tabular} style={styles.value}>
        {value}
      </AppText>
    </View>
  );
}

function UsageMeter({
  report,
  onExportGroupFile,
}: {
  report: UsageReport;
  onExportGroupFile: () => void;
}) {
  const { tokens } = useTheme();
  const { usage } = report;
  const label = usageLabel(usage);
  const warning = usageWarning(usage);
  return (
    <View style={styles.usage}>
      <View
        accessible
        accessibilityRole="progressbar"
        accessibilityLabel={`Usage: ${label}`}
        accessibilityValue={{ min: 0, max: 100, now: Math.min(100, usagePercent(usage.fraction)) }}
        style={styles.meter}
      >
        <View style={styles.usageLine}>
          <AppText variant="callout">Usage</AppText>
          <AppText
            variant="subhead"
            color={warning === null ? 'textSecondary' : 'text'}
            weight={warning === null ? 'regular' : 'semibold'}
            tabular
          >
            {label}
          </AppText>
        </View>
        <View style={[styles.track, { backgroundColor: tokens.barTrack }]}>
          <View
            style={[
              styles.fill,
              {
                width: `${meterFill(usage) * 100}%`,
                backgroundColor: warning === null ? tokens.accent : tokens.text,
              },
            ]}
          />
        </View>
      </View>
      {warning !== null && (
        <>
          <View style={styles.warning} accessibilityRole="alert">
            <View style={styles.warningIcon}>
              <Icon name="warning" size={16} color={tokens.text} strokeWidth={2.2} />
            </View>
            <AppText variant="subheadLoose" weight="semibold" style={styles.flex}>
              {warning}
            </AppText>
          </View>
          <Button
            label="Export group file"
            variant="secondary"
            size="compact"
            fullWidth={false}
            onPress={onExportGroupFile}
            style={styles.export}
          />
        </>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  card: { marginHorizontal: layout.gutter },
  infoRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    minHeight: 48,
    paddingHorizontal: 16,
  },
  label: { width: 80, flexShrink: 0 },
  value: { flex: 1 },
  usage: { gap: 8, paddingVertical: 14, paddingHorizontal: 16 },
  meter: { gap: 8 },
  usageLine: { flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between' },
  track: { height: 8, borderRadius: radii.meter },
  fill: { height: 8, borderRadius: radii.meter },
  /** 6 below the bar (the 8 pt gap and 6 more), as drawn. */
  warning: { flexDirection: 'row', alignItems: 'flex-start', gap: 8, marginTop: 6 },
  warningIcon: { paddingTop: 2 },
  export: { alignSelf: 'flex-start', marginTop: 2 },
});
