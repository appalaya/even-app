/**
 * Scan invite (JoinScan, JoinScanNotInvite, JoinScanFound, JoinScanDenied and their dark twins): a sheet at the
 * safe-area top over Groups, Cancel and "Scan invite" in its header, then a 470 pt viewfinder (radius 24, inset 16,
 * 8 below the header) showing the back camera, reading QR codes only:
 * - the 248 pt corner brackets (36 pt arms, 4 pt, radius 16) in `onViewfinder`, 91 from the viewfinder's top;
 * - the 44 pt light (torch) button, `viewfinderControl`, 20 above its foot;
 * - under it "Point the camera at the QR code on their phone. It reads on its own." 15/21 `textSecondary`, centred,
 *   20 below, inset 32.
 * A code that is not an Even invite (`readScan`) keeps the camera reading and puts the 16 pt warning with "That QR
 * code isn't an Even invite." 16/22 semibold and "Keep scanning, or cancel and paste the code." under it. An invite
 * turns the brackets to the accent with a 56 pt accent check in their middle (a 4 pt `onViewfinder` ring), and
 * "Invite found" · "Opening it in Join with code…" under it; `FOUND_MS` later its code goes to Join with code, which
 * previews it exactly as a pasted one (JoinCodePreview).
 *
 * Camera access off: the viewfinder becomes a `fill` panel with the 32 pt camera-off glyph, "Camera access is off",
 * "To scan an invite, allow Even to use the camera in Settings. You can still paste the code.", Open Settings (the
 * system settings for Even) and "Paste instead" (back to Join with code). Coming back from Settings re-reads the
 * permission.
 */
import { CameraView, useCameraPermissions, type BarcodeScanningResult } from 'expo-camera';
import * as Haptics from 'expo-haptics';
import { useEffect, useRef, useState } from 'react';
import { AppState, Linking, Pressable, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { AppText, Button, Icon, Sheet } from '@/components';
import { useTheme } from '@/theme';

import { readScan } from './scan';

/** How long "Invite found" shows before Join with code takes the code. */
export const FOUND_MS = 900;

type Phase = { kind: 'scanning' } | { kind: 'notInvite' } | { kind: 'found'; code: string };

export interface ScanSheetProps {
  visible: boolean;
  /** Cancel, a swipe down, or the scrim: back to Join with code. */
  onCancel: () => void;
  /** "Paste instead" on the camera-off panel: back to Join with code. */
  onPasteInstead: () => void;
  /** An invite was read: its bare code, for the code field. */
  onFound: (code: string) => void;
}

export function ScanSheet({ visible, onCancel, onPasteInstead, onFound }: ScanSheetProps) {
  const insets = useSafeAreaInsets();
  const [permission, requestPermission, getPermission] = useCameraPermissions();
  const [phase, setPhase] = useState<Phase>({ kind: 'scanning' });
  const [torch, setTorch] = useState(false);
  const found = useRef(false);

  // Ask once, when the sheet opens on a phone that has not been asked yet.
  const status = permission?.status;
  useEffect(() => {
    if (visible && status === 'undetermined') void requestPermission();
  }, [visible, status, requestPermission]);

  // Back from Settings (or any return to the app): the answer may have changed.
  useEffect(() => {
    if (!visible) return;
    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'active') void getPermission();
    });
    return () => sub.remove();
  }, [visible, getPermission]);

  // Hand the found code over after the found state has shown.
  const foundCode = phase.kind === 'found' ? phase.code : null;
  useEffect(() => {
    if (foundCode === null) return;
    const timer = setTimeout(() => onFound(foundCode), FOUND_MS);
    return () => clearTimeout(timer);
  }, [foundCode, onFound]);

  const onScanned = ({ data }: BarcodeScanningResult) => {
    if (found.current) return;
    const verdict = readScan(data);
    if (verdict.kind === 'invite') {
      found.current = true;
      setTorch(false);
      setPhase({ kind: 'found', code: verdict.code });
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    } else if (phase.kind !== 'notInvite') {
      setPhase({ kind: 'notInvite' });
    }
  };

  const granted = permission?.granted === true;
  const denied = permission !== null && !permission.granted && permission.status === 'denied';

  return (
    <Sheet
      visible={visible}
      onDismiss={onCancel}
      top={insets.top}
      leftAction={{ label: 'Cancel', onPress: onCancel }}
      navTitle="Scan invite"
      accessibilityLabel="Scan invite"
    >
      {denied ? (
        <CameraOff onPasteInstead={onPasteInstead} />
      ) : (
        <Viewfinder
          camera={granted && visible}
          found={phase.kind === 'found'}
          torch={torch}
          onTorch={() => setTorch((on) => !on)}
          onScanned={phase.kind === 'found' ? undefined : onScanned}
        />
      )}
      {!denied && <Caption phase={phase.kind} />}
    </Sheet>
  );
}

function Viewfinder({
  camera,
  found,
  torch,
  onTorch,
  onScanned,
}: {
  camera: boolean;
  found: boolean;
  torch: boolean;
  onTorch: () => void;
  onScanned: ((result: BarcodeScanningResult) => void) | undefined;
}) {
  const { tokens } = useTheme();
  const bracket = found ? tokens.accent : tokens.onViewfinder;
  return (
    <View style={[styles.viewfinder, { backgroundColor: tokens.viewfinder }]}>
      {camera && (
        <CameraView
          style={StyleSheet.absoluteFill}
          facing="back"
          active={camera}
          enableTorch={torch}
          barcodeScannerSettings={{ barcodeTypes: ['qr'] }}
          onBarcodeScanned={onScanned}
          accessibilityElementsHidden
          importantForAccessibility="no-hide-descendants"
        />
      )}
      <View pointerEvents="none" style={styles.brackets}>
        <View style={[styles.arm, styles.topLeft, { borderColor: bracket }]} />
        <View style={[styles.arm, styles.topRight, { borderColor: bracket }]} />
        <View style={[styles.arm, styles.bottomRight, { borderColor: bracket }]} />
        <View style={[styles.arm, styles.bottomLeft, { borderColor: bracket }]} />
      </View>
      {found && (
        <View
          pointerEvents="none"
          style={[
            styles.foundMark,
            {
              backgroundColor: tokens.accent,
              boxShadow: `0 0 0 4px ${tokens.onViewfinder}`,
            },
          ]}
        >
          <Icon name="check" size={28} color={tokens.onAccent} />
        </View>
      )}
      <Pressable
        onPress={onTorch}
        accessibilityRole="button"
        accessibilityLabel={torch ? 'Turn off the light' : 'Turn on the light'}
        accessibilityState={{ selected: torch }}
        style={({ pressed }) => [
          styles.torch,
          { backgroundColor: tokens.viewfinderControl },
          pressed && styles.pressed,
        ]}
      >
        <Icon name="flashlight" size={20} color={tokens.onViewfinder} />
      </Pressable>
    </View>
  );
}

function Caption({ phase }: { phase: Phase['kind'] }) {
  const { tokens } = useTheme();
  switch (phase) {
    case 'scanning':
      return (
        <AppText variant="subheadLoose" color="textSecondary" align="center" style={styles.caption}>
          Point the camera at the QR code on their phone. It reads on its own.
        </AppText>
      );
    case 'notInvite':
      return (
        <View accessibilityRole="alert" accessibilityLiveRegion="polite">
          <View style={[styles.caption, styles.notInvite]}>
            <View style={styles.warningGlyph}>
              <Icon name="warning" size={16} color={tokens.text} strokeWidth={2.2} />
            </View>
            <AppText weight="semibold" style={styles.notInviteText}>
              That QR code isn&apos;t an Even invite.
            </AppText>
          </View>
          <AppText variant="subheadLoose" color="textSecondary" style={styles.keepScanning}>
            Keep scanning, or cancel and paste the code.
          </AppText>
        </View>
      );
    case 'found':
      return (
        <View accessibilityLiveRegion="polite">
          <View style={[styles.caption, styles.foundLine]}>
            <Icon name="check" size={16} color={tokens.accent} strokeWidth={2.8} />
            <AppText weight="semibold">Invite found</AppText>
          </View>
          <AppText
            variant="subheadLoose"
            color="textSecondary"
            align="center"
            style={styles.opening}
          >
            Opening it in Join with code…
          </AppText>
        </View>
      );
  }
}

function CameraOff({ onPasteInstead }: { onPasteInstead: () => void }) {
  const { tokens } = useTheme();
  return (
    <View style={[styles.viewfinder, styles.off, { backgroundColor: tokens.fill }]}>
      <Icon name="cameraOff" size={32} color={tokens.textSecondary} />
      <AppText variant="headline" align="center" accessibilityRole="header" style={styles.offTitle}>
        Camera access is off
      </AppText>
      <AppText variant="subheadLoose" color="textSecondary" align="center" style={styles.offBody}>
        To scan an invite, allow Even to use the camera in Settings. You can still paste the code.
      </AppText>
      <Button
        label="Open Settings"
        size="medium"
        fullWidth={false}
        onPress={() => void Linking.openSettings()}
        style={styles.openSettings}
      />
      <Button
        label="Paste instead"
        variant="quiet"
        size="small"
        fullWidth={false}
        onPress={onPasteInstead}
        style={styles.pasteInstead}
      />
    </View>
  );
}

/** The drawn viewfinder: 248 pt brackets 91 from its top, centred across. */
const BRACKETS = 248;
const BRACKETS_TOP = 91;
const ARM = 36;
const FOUND_MARK = 56;

const styles = StyleSheet.create({
  viewfinder: {
    height: 470,
    marginTop: 8,
    marginHorizontal: 16,
    borderRadius: 24,
    overflow: 'hidden',
  },
  brackets: {
    position: 'absolute',
    top: BRACKETS_TOP,
    left: '50%',
    marginLeft: -BRACKETS / 2,
    width: BRACKETS,
    height: BRACKETS,
  },
  arm: { position: 'absolute', width: ARM, height: ARM },
  topLeft: {
    top: 0,
    left: 0,
    borderTopWidth: 4,
    borderLeftWidth: 4,
    borderTopLeftRadius: 16,
  },
  topRight: {
    top: 0,
    right: 0,
    borderTopWidth: 4,
    borderRightWidth: 4,
    borderTopRightRadius: 16,
  },
  bottomRight: {
    bottom: 0,
    right: 0,
    borderBottomWidth: 4,
    borderRightWidth: 4,
    borderBottomRightRadius: 16,
  },
  bottomLeft: {
    bottom: 0,
    left: 0,
    borderBottomWidth: 4,
    borderLeftWidth: 4,
    borderBottomLeftRadius: 16,
  },
  foundMark: {
    position: 'absolute',
    top: BRACKETS_TOP + (BRACKETS - FOUND_MARK) / 2,
    left: '50%',
    marginLeft: -FOUND_MARK / 2,
    width: FOUND_MARK,
    height: FOUND_MARK,
    borderRadius: FOUND_MARK / 2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  torch: {
    position: 'absolute',
    bottom: 20,
    left: '50%',
    marginLeft: -22,
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: 'center',
    justifyContent: 'center',
  },
  pressed: { opacity: 0.7 },
  caption: { marginTop: 20, marginHorizontal: 32 },
  notInvite: { flexDirection: 'row', alignItems: 'flex-start', gap: 8 },
  warningGlyph: { paddingTop: 3 },
  notInviteText: { flex: 1, fontSize: 16, lineHeight: 22 },
  /** Under the message's text: 32 + the 16 pt glyph + 8. */
  keepScanning: { marginTop: 4, marginLeft: 56, marginRight: 32 },
  foundLine: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8 },
  opening: { marginTop: 4, marginHorizontal: 32 },
  off: { paddingHorizontal: 28, alignItems: 'center', justifyContent: 'center' },
  offTitle: { marginTop: 16 },
  offBody: { marginTop: 8 },
  openSettings: { marginTop: 20, paddingHorizontal: 24 },
  pasteInstead: { marginTop: 4, paddingHorizontal: 12 },
});
