/**
 * Move server (Group settings, extra states: "Move server, checked"): a sheet 116 from the top, Cancel and "Move
 * server" in its header; "Banff 2026 is on sync.even.appalaya.com. After the move, everyone else is asked to
 * follow."; "New server" with the address field (starting at the current URL) and "Check" beside it. Check reads the
 * server's `/v1/info`: a good answer shows "✓ home.example.net is an Even server" with its operator, limits,
 * retention and this group against its caps; "Move" turns on after a good Check and off again once the address is
 * edited. What goes wrong reads as the error-copy panel words it, under the field. The board's caption under the
 * details ("From /v1/info. Move turns on after …") is a designer's note describing that behaviour, not copy.
 */
import { useEffect, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import {
  AppText,
  Button,
  Card,
  FieldLabel,
  Icon,
  Sheet,
  SheetHeader,
  TextField,
} from '@/components';
import { serverAddressProblem, serverProblemMessage } from '@/features/groups/serverCopy';
import { layout, useTheme } from '@/theme';
import { useApp, type ServerCheck } from '../../state';

import { groupAgainstLabel, hostOf, limitsLabel, operatorLabel, retentionLabel } from './model';

/** The sheet's top edge below the safe area, as drawn (116 − 62). */
const TOP_BELOW_SAFE_AREA = 54;

export interface MoveServerSheetProps {
  visible: boolean;
  localId: string;
  groupName: string;
  serverUrl: string;
  /** Moves to the checked server; resolves with the problem to show, or null once moved. */
  onMove: (serverUrl: string) => Promise<string | null>;
  onDismiss: () => void;
  /** Development screenshots: the address to type and check. */
  initialValue?: string;
  checkOnOpen?: boolean;
}

export function MoveServerSheet({ visible, onDismiss, ...body }: MoveServerSheetProps) {
  const insets = useSafeAreaInsets();
  return (
    <Sheet
      visible={visible}
      onDismiss={onDismiss}
      top={insets.top + TOP_BELOW_SAFE_AREA}
      accessibilityLabel="Move server"
    >
      <MoveBody onDismiss={onDismiss} {...body} />
    </Sheet>
  );
}

type Checked = Extract<ServerCheck, { ok: true }>;

function MoveBody({
  localId,
  groupName,
  serverUrl,
  onMove,
  onDismiss,
  initialValue,
  checkOnOpen = false,
}: Omit<MoveServerSheetProps, 'visible'>) {
  const { tokens } = useTheme();
  const { groups } = useApp();
  const [url, setUrl] = useState(initialValue ?? serverUrl);
  const [checked, setChecked] = useState<Checked | null>(null);
  const [error, setError] = useState<string | undefined>();
  const [busy, setBusy] = useState(false);

  const check = async (address: string) => {
    setBusy(true);
    setError(undefined);
    try {
      const result = await groups.checkServer(address, localId);
      if (!result.ok) {
        setChecked(null);
        setError(serverProblemMessage(result.problem));
      } else if (result.serverUrl === serverUrl) {
        setChecked(null);
        setError(`This group already syncs through ${hostOf(serverUrl)}.`);
      } else {
        setChecked(result);
      }
    } finally {
      setBusy(false);
    }
  };
  useEffect(() => {
    if (!checkOnOpen) return;
    // Development screenshots only: once, when the sheet opens, as a tap on Check would.
    const timer = setTimeout(() => void check(url), 0);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const move = async () => {
    if (checked === null) return;
    setBusy(true);
    try {
      const problem = await onMove(checked.serverUrl);
      if (problem !== null) setError(problem);
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <SheetHeader leftAction={{ label: 'Cancel', onPress: onDismiss }} navTitle="Move server" />
      <AppText variant="subheadLoose" color="textSecondary" style={styles.intro}>
        {`${groupName} is on ${hostOf(serverUrl)}. After the move, everyone else is asked to follow.`}
      </AppText>
      <View style={styles.group}>
        <FieldLabel>New server</FieldLabel>
        <View style={styles.fieldRow}>
          <TextField
            variant="url"
            radius={14}
            value={url}
            onChangeText={(text) => {
              setUrl(text);
              setChecked(null);
              setError(undefined);
            }}
            onBlur={() => {
              const problem = serverAddressProblem(url);
              if (problem !== null) setError(serverProblemMessage(problem));
            }}
            accessibilityLabel="New server"
            autoCapitalize="none"
            autoCorrect={false}
            keyboardType="url"
            returnKeyType="go"
            onSubmitEditing={() => void check(url)}
            error={error}
            containerStyle={styles.field}
          />
          <Button
            label="Check"
            variant="secondary"
            size="medium"
            fullWidth={false}
            disabled={busy || url.trim() === ''}
            onPress={() => void check(url)}
            style={styles.check}
          />
        </View>
      </View>
      {checked !== null && (
        <Card tone="fill" radius="group" separatorInset={16} style={styles.details}>
          <View style={styles.status} accessibilityRole="text">
            <Icon name="check" size={16} color={tokens.accent} strokeWidth={2.8} />
            <AppText variant="subhead" weight="semibold" style={styles.flex}>
              {`${hostOf(checked.serverUrl)} is an Even server`}
            </AppText>
          </View>
          <Detail label="Operator" value={operatorLabel(checked.info)} />
          <Detail label="Limits" value={limitsLabel(checked.info)} />
          <Detail label="Keeps" value={retentionLabel(checked.info.retention_days)} />
          {checked.usage !== null && (
            <Detail label="This group" value={groupAgainstLabel(checked.usage)} />
          )}
        </Card>
      )}
      <View style={styles.flex} />
      <Button
        label="Move"
        disabled={checked === null || busy}
        onPress={() => void move()}
        style={styles.move}
      />
    </>
  );
}

function Detail({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.detail} accessible accessibilityLabel={`${label}: ${value}`}>
      <AppText variant="callout" color="textSecondary" style={styles.label}>
        {label}
      </AppText>
      <AppText variant="callout" align="right" tabular style={styles.flex}>
        {value}
      </AppText>
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  intro: { marginTop: 8, marginHorizontal: layout.textInset },
  group: { gap: 6, marginTop: 16, marginHorizontal: layout.gutter },
  fieldRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 8 },
  field: { flex: 1 },
  // The kit button centres itself when not full width; keep Check level with the field when the error line shows.
  check: { paddingHorizontal: 18, alignSelf: 'flex-start' },
  details: { marginTop: 16, marginHorizontal: layout.gutter },
  status: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    minHeight: 48,
    paddingHorizontal: 16,
  },
  detail: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    minHeight: 48,
    paddingHorizontal: 16,
  },
  label: { width: 80, flexShrink: 0 },
  move: { marginHorizontal: layout.gutter },
});
