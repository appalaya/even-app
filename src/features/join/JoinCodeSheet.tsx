/**
 * Join with code (JoinCode, JoinCodePreview, JoinCodeError and their dark twins): a sheet 150 pt from the top (the
 * safe area + 88) over Groups, Cancel and "Join with code" in its header (title inset 100), then:
 * - "Paste the code someone sent you, or scan it from their phone. A full invite link works too." 15/21
 *   `textSecondary`, 8 below, inset 20;
 * - the 208 pt code field with its Scan and Paste pills, 16 below, inset 16 (Scan opens `ScanSheet`);
 * - empty: nothing more, and Join disabled;
 * - read: an outlined card 16 below (padding 16 18, gap 4): "Code complete" with a 13 pt check, "Join Banff 2026?"
 *   24/30 bold, "Canadian dollar · CAD" 15/20 `textSecondary`, the server host with a 13 pt lock 4 further down;
 *   then "Nothing is sent until you tap Join." 13/18 `textMuted` 10 below, inset 20; Join enabled;
 * - incomplete: the field ringed and "That code isn't complete. Copy it again." under it; Join disabled;
 * - a newer version: "This invite needs a newer Even." and an Update button to the store (error-copy panel).
 * Join sits at the foot, inset 16.
 */
import * as Clipboard from 'expo-clipboard';
import { Linking, StyleSheet, View, Platform } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { AppText, Button, Card, Icon, Sheet, TextField } from '@/components';
import { currencyName } from '@/features/groups/currencies';
import type { InvitePreview } from '@/state';
import { useTheme } from '@/theme';
import { LINKS } from '@/features/settings/about';

export type CodeState =
  | { kind: 'empty' }
  | { kind: 'read'; invite: InvitePreview }
  /** `update`: the invite needs a newer Even; offer the store. */
  | { kind: 'error'; message: string; update?: boolean };

/** "Update" opens this phone's store listing. */
const UPDATE_URL = Platform.OS === 'android' ? LINKS.store.android : LINKS.store.ios;

export interface JoinCodeSheetProps {
  visible: boolean;
  onCancel: () => void;
  text: string;
  onChangeText: (text: string) => void;
  /** The Scan pill: the invite scanner (JoinScan). */
  onScan: () => void;
  state: CodeState;
  onJoin: () => void;
  busy: boolean;
}

export function JoinCodeSheet({
  visible,
  onCancel,
  text,
  onChangeText,
  onScan,
  state,
  onJoin,
  busy,
}: JoinCodeSheetProps) {
  const insets = useSafeAreaInsets();

  const paste = async () => {
    try {
      const pasted = await Clipboard.getStringAsync();
      if (pasted.trim() !== '') onChangeText(pasted.trim());
    } catch {
      // Nothing to paste, or the user declined the paste prompt.
    }
  };

  return (
    <Sheet
      visible={visible}
      onDismiss={onCancel}
      top={insets.top + 88}
      leftAction={{ label: 'Cancel', onPress: onCancel }}
      navTitle="Join with code"
      navTitleInset={100}
      accessibilityLabel="Join with code"
    >
      <AppText variant="subheadLoose" color="textSecondary" style={styles.intro}>
        Paste the code someone sent you, or scan it from their phone. A full invite link works too.
      </AppText>
      <TextField
        variant="code"
        value={text}
        onChangeText={onChangeText}
        placeholder="Paste a code or link"
        accessibilityLabel="Invite code"
        autoCapitalize="none"
        autoCorrect={false}
        spellCheck={false}
        onPaste={() => void paste()}
        onScan={onScan}
        error={state.kind === 'error' ? state.message : undefined}
        containerStyle={styles.field}
      />
      {state.kind === 'read' && <InviteCard invite={state.invite} />}
      {state.kind === 'error' && state.update === true && (
        <Button
          label="Update"
          variant="secondary"
          size="compact"
          fullWidth={false}
          onPress={() => void Linking.openURL(UPDATE_URL)}
          style={styles.update}
        />
      )}
      <View style={styles.flex} />
      <Button
        label="Join"
        onPress={onJoin}
        disabled={state.kind !== 'read' || busy}
        style={styles.join}
      />
    </Sheet>
  );
}

function InviteCard({ invite }: { invite: InvitePreview }) {
  const { tokens } = useTheme();
  return (
    <>
      <Card tone="outline" style={styles.card}>
        <View style={styles.line}>
          <Icon name="check" size={13} color={tokens.textMuted} strokeWidth={2.8} />
          <AppText variant="caption" color="textMuted">
            Code complete
          </AppText>
        </View>
        <AppText variant="title2" accessibilityRole="header">
          {`Join ${invite.name ?? 'a group'}?`}
        </AppText>
        {invite.currency !== null && (
          <AppText variant="subhead" color="textSecondary">
            {`${currencyName(invite.currency)} · ${invite.currency}`}
          </AppText>
        )}
        <View style={[styles.line, styles.host]}>
          <Icon name="lock" size={13} color={tokens.textMuted} strokeWidth={2.2} />
          <AppText variant="caption" color="textMuted">
            {invite.host}
          </AppText>
        </View>
      </Card>
      <AppText variant="caption" color="textMuted" style={styles.note}>
        Nothing is sent until you tap Join.
      </AppText>
    </>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  intro: { marginTop: 8, marginHorizontal: 20 },
  field: { marginTop: 16, marginHorizontal: 16 },
  card: { marginTop: 16, marginHorizontal: 16, paddingVertical: 16, paddingHorizontal: 18, gap: 4 },
  line: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  host: { marginTop: 4 },
  note: { marginTop: 10, marginHorizontal: 20 },
  join: { marginHorizontal: 16 },
  update: { alignSelf: 'flex-start', marginTop: 10, marginLeft: 46 },
});
