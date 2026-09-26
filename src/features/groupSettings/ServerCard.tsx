import { StyleSheet, View } from 'react-native';

import { AppText, Card, ListRow } from '@/components';
import { layout, radii, useTheme } from '@/theme';
import type { UsageReport } from '../../state';

import { hostOf, limitsLabel, meterFill, retentionLabel, usageLabel, usagePercent } from './model';

export interface ServerCardProps {
  serverUrl: string;
  /** The server's `/v1/info` and this group's usage; null or undefined while unknown. */
  report: UsageReport | null | undefined;
  /** The server this group was moved away from in this session: offer to delete the copy there. */
  oldServer: string | null;
  readOnly: boolean;
  onMove: () => void;
  onDeleteOldCopy: () => void;
}

/**
 * Group settings → Server (GroupSettings board): Host, Operator, Limits and Keeps as 48 pt rows (label 80 wide in
 * `textSecondary`, value right-aligned), the usage meter (8 pt, accent on `barTrack`), then "Move to another
 * server" in the accent. Rows the server's info would fill are left out until it is known.
 */
export function ServerCard({
  serverUrl,
  report,
  oldServer,
  readOnly,
  onMove,
  onDeleteOldCopy,
}: ServerCardProps) {
  const info = report?.info;
  return (
    <Card radius="group" separatorInset={16} style={styles.card} accessibilityLabel="Server">
      <InfoRow label="Host" value={hostOf(serverUrl)} />
      {info?.operator !== undefined && info.operator !== '' && (
        <InfoRow label="Operator" value={info.operator} />
      )}
      {info !== undefined && <InfoRow label="Limits" value={limitsLabel(info)} tabular />}
      {info !== undefined && <InfoRow label="Keeps" value={retentionLabel(info.retention_days)} />}
      {report != null && <UsageMeter report={report} />}
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
          title={`Delete the copy on ${hostOf(oldServer)}`}
          titleColor="accent"
          titleWeight="medium"
          chevron="accent"
          onPress={onDeleteOldCopy}
        />
      )}
    </Card>
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

function UsageMeter({ report }: { report: UsageReport }) {
  const { tokens } = useTheme();
  const { usage } = report;
  const label = usageLabel(usage);
  return (
    <View
      style={styles.usage}
      accessible
      accessibilityRole="progressbar"
      accessibilityLabel={`Usage: ${label}`}
      accessibilityValue={{ min: 0, max: 100, now: Math.min(100, usagePercent(usage.fraction)) }}
    >
      <View style={styles.usageLine}>
        <AppText variant="callout">Usage</AppText>
        <AppText variant="subhead" color="textSecondary" tabular>
          {label}
        </AppText>
      </View>
      <View style={[styles.track, { backgroundColor: tokens.barTrack }]}>
        <View
          style={[
            styles.fill,
            { width: `${meterFill(usage) * 100}%`, backgroundColor: tokens.accent },
          ]}
        />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
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
  usageLine: { flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between' },
  track: { height: 8, borderRadius: radii.meter },
  fill: { height: 8, borderRadius: radii.meter },
});
