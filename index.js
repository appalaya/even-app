// The app's entry (package.json "main"), on iOS and Android. Its imports run in this order when the bundle loads.
// A headless start, when the OS wakes the app only for the background task (Android's WorkManager from a killed
// process), evaluates this file but never the root layout (src/app/_layout.tsx), so what the task needs is set up
// here, not there.

// crypto.getRandomValues, before anything can call @even/core.
import './src/polyfills';
// TaskManager.defineTask for the background refresh (idempotent), before the OS asks for the task.
import './src/services/background/task';
// Expo Router's own entry: registers the root component.
import 'expo-router/entry';
