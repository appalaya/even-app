import Constants from 'expo-constants';

import { versionLabel } from './about';

/** This binary's version and build as About and Diagnostics write it: "1.0 (120)". */
export const APP_VERSION = versionLabel(
  Constants.expoConfig?.version,
  Constants.platform?.ios?.buildNumber ?? Constants.expoConfig?.ios?.buildNumber,
);
