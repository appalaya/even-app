/**
 * "Scan to join" (InviteQR and its dark twin): a sheet at the safe-area top over the screen that opened it, "Scan to
 * join" centred and Done at the trailing edge, then:
 * - the group name 30/36 bold (−0.5), centred, 20 below the header, inset 20;
 * - "Point a phone's camera at the code." 15/21 `textSecondary`, 4 below;
 * - a 304 pt `qrTile` tile (radius 24, padding 20), 24 below, holding the 264 pt QR of the invite link in `qrModule`:
 *   white and near-black in both modes, since a camera needs dark modules on light;
 * - "Their camera opens Even, or the invite page if they don't have Even yet." 15/21 `textSecondary`, centred, 20
 *   below, inset 32;
 * - the 18 pt key and "Anyone who scans this can see and edit the group." 15/21 `text`, 16 below, inset 28, gap 10.
 *
 * The screen goes to full brightness while the sheet is up (`useBrightScreen`).
 *
 * Until the invite exists and the server has the group (`invite` null or not `ready`), the tile stays empty and the
 * line under the name is the invite card's waiting line (InviteSyncing): the small ring and "Preparing your invite…".
 */
import { useMemo } from 'react';
import { StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Svg, { Path, Rect } from 'react-native-svg';

import { AppText, Icon, ProgressRing, Sheet } from '@/components';
import { layout, useTheme } from '@/theme';

import { qrMatrix, qrPath } from './qr';
import { useBrightScreen } from './useBrightScreen';

export type InviteQrSheetProps = {
  visible: boolean;
  onClose: () => void;
  invite: { code: string; link: string; ready: boolean } | null;
  groupName: string;
};

/** The QR as drawn: 264 pt inside a 304 pt tile. */
const QR_SIZE = 264;
const TILE_SIZE = 304;

export function InviteQrSheet({ visible, onClose, invite, groupName }: InviteQrSheetProps) {
  const insets = useSafeAreaInsets();
  const ready = invite !== null && invite.ready;
  useBrightScreen(visible && ready);

  return (
    <Sheet
      visible={visible}
      onDismiss={onClose}
      top={insets.top}
      rightAction={{ label: 'Done', onPress: onClose }}
      navTitle="Scan to join"
      accessibilityLabel="Scan to join"
    >
      <AppText variant="title1" align="center" accessibilityRole="header" style={styles.name}>
        {groupName}
      </AppText>
      {ready ? (
        <AppText variant="subheadLoose" color="textSecondary" align="center" style={styles.point}>
          Point a phone&apos;s camera at the code.
        </AppText>
      ) : (
        <View
          style={[styles.point, styles.preparing]}
          accessibilityRole="progressbar"
          accessibilityLiveRegion="polite"
        >
          <ProgressRing />
          <AppText variant="subheadLoose" color="textSecondary">
            Preparing your invite…
          </AppText>
        </View>
      )}
      <QrTile link={ready ? invite.link : null} />
      <AppText variant="subheadLoose" color="textSecondary" align="center" style={styles.opens}>
        Their camera opens Even, or the invite page if they don&apos;t have Even yet.
      </AppText>
      <Warning />
    </Sheet>
  );
}

/** The white tile and, once there is a link, its QR. */
function QrTile({ link }: { link: string | null }) {
  const { tokens } = useTheme();
  const qr = useMemo(() => {
    if (link === null) return null;
    const matrix = qrMatrix(link);
    return { size: matrix.size, d: qrPath(matrix) };
  }, [link]);
  return (
    <View style={[styles.tile, { backgroundColor: tokens.qrTile }]}>
      {qr !== null && (
        <Svg
          width={QR_SIZE}
          height={QR_SIZE}
          viewBox={`0 0 ${qr.size} ${qr.size}`}
          accessible
          accessibilityRole="image"
          accessibilityLabel="QR code for the invite link"
        >
          <Rect width={qr.size} height={qr.size} fill={tokens.qrTile} />
          <Path d={qr.d} fill={tokens.qrModule} />
        </Svg>
      )}
    </View>
  );
}

function Warning() {
  const { tokens } = useTheme();
  return (
    <View style={styles.warning}>
      <View style={styles.key}>
        <Icon name="key" size={18} color={tokens.textSecondary} />
      </View>
      <AppText variant="subheadLoose" style={styles.flex}>
        Anyone who scans this can see and edit the group.
      </AppText>
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  name: { marginTop: 20, marginHorizontal: layout.textInset },
  point: { marginTop: 4, marginHorizontal: layout.textInset },
  preparing: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8 },
  tile: {
    alignSelf: 'center',
    width: TILE_SIZE,
    height: TILE_SIZE,
    marginTop: 24,
    padding: (TILE_SIZE - QR_SIZE) / 2,
    borderRadius: 24,
  },
  opens: { marginTop: 20, marginHorizontal: 32 },
  warning: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 10,
    marginTop: 16,
    marginHorizontal: 28,
  },
  key: { paddingTop: 2 },
});
