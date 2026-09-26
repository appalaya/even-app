/**
 * The app's `Secrets`: expo-secure-store (iOS keychain, Android keystore) with accessibility
 * `AFTER_FIRST_UNLOCK` on every call, so the background task can read keys while the phone is locked after its
 * first unlock since boot (design.md "Keys"). Never `WHEN_UNLOCKED*` or `*_THIS_DEVICE_ONLY`: the iOS keychain
 * backup is the restore path. No `requireAuthentication`: a biometric prompt would block background refresh.
 */
import * as SecureStore from 'expo-secure-store';

import { createSecrets, type SecretKeyValue } from './createSecrets';
import type { Secrets } from './types';

/**
 * Passed on reads and deletes too: expo-secure-store ignores the accessibility there, and passing the same
 * options everywhere keeps any future option (a keychain service or access group) consistent across calls.
 */
export const SECURE_STORE_OPTIONS: SecureStore.SecureStoreOptions = {
  keychainAccessible: SecureStore.AFTER_FIRST_UNLOCK,
};

export const secureStoreKeyValue: SecretKeyValue = {
  getItem: (key) => SecureStore.getItemAsync(key, SECURE_STORE_OPTIONS),
  setItem: (key, value) => SecureStore.setItemAsync(key, value, SECURE_STORE_OPTIONS),
  deleteItem: (key) => SecureStore.deleteItemAsync(key, SECURE_STORE_OPTIONS),
};

/** The process-wide instance. Use only this one: operations are serialised per instance. */
export const secrets: Secrets = createSecrets(secureStoreKeyValue);
