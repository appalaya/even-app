/**
 * The device wiring: expo-sqlite store, expo-secure-store secrets, `HttpTransport` per server origin, expo file
 * sharing, expo-notifications' permission, and the category chip's on-device model and history. One instance per
 * process (the background task, a later step, reuses it). Never imported by Node tests.
 *
 * A development build reaches a server on this machine or its local network over plain http (the dev server,
 * `npm run dev:server`, that the dev seed syncs with), still deriving keys for the https form. A release build
 * never does: `__DEV__` is false there and every transport refuses http.
 */
import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';

import EvenClassifier from '../../modules/even-classifier';
import EvenCrypto from '../../modules/even-crypto';
import { installNativeAead } from '../services/crypto/nativeAead';
import { expoFileIO } from '../services/groupFile/expoFileIO';
import { secrets } from '../services/secrets/secureStore';
import { openStore } from '../services/storage/openStore';
import { HttpTransport, localHttpUrl } from '../services/sync/httpTransport';
import { createInfoCache } from '../services/sync/info';
import { setCategoryHistory, setOnDeviceModel } from './categories';
import type { NotificationPermission } from './prefs';
import { createAppServices, type AppServices } from './services';

// The on-device model behind the category chip (design.md "Model refinement"); null in a build without the native
// module, and then the chip keeps its keyword guess. Nothing is asked of it until a title pauses.
setOnDeviceModel(EvenClassifier);

const notifications: NotificationPermission = {
  // Android 13 and later ask with a dialog that Back or a tap outside closes with no answer (POST_NOTIFICATIONS; on
  // older Android there is no prompt). iOS's alert cannot be closed without one.
  dismissible:
    Platform.OS === 'android' && typeof Platform.Version === 'number' && Platform.Version >= 33,
  status: () => Notifications.getPermissionsAsync(),
  request: () => Notifications.requestPermissionsAsync(),
};

let opened: Promise<AppServices> | null = null;

/** Opens (once per process) the app's services. A failed open is not cached, so a later call can retry. */
export function openAppServices(): Promise<AppServices> {
  if (opened === null) {
    // Native XChaCha20-Poly1305 for every seal and open from here on, once it agrees with @noble on its self-test;
    // @noble otherwise (design.md "Crypto"). Before the store opens, so the first derive already runs on it.
    installNativeAead(EvenCrypto);
    const transports = new Map<string, HttpTransport>();
    const transportFor = (serverUrl: string): HttpTransport => {
      let transport = transports.get(serverUrl);
      if (transport === undefined) {
        const local = __DEV__ ? localHttpUrl(serverUrl) : null;
        transport =
          local === null
            ? new HttpTransport(serverUrl)
            : new HttpTransport(local, { allowInsecureLocal: true });
        transports.set(serverUrl, transport);
      }
      return transport;
    };
    const run = openStore().then((store) =>
      createAppServices({
        store,
        secrets,
        transportFor,
        infoCache: createInfoCache(),
        files: expoFileIO,
        notifications,
      }),
    );
    // History first on the category chip: the expenses already in the groups this process has decrypted, read in
    // memory and never stored again (design.md "Model refinement").
    run.then(
      (services) => setCategoryHistory((openGroup) => services.groupState.peekStates(openGroup)),
      () => {
        opened = null;
      },
    );
    opened = run;
  }
  return opened;
}
