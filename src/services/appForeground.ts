/**
 * Tells `yieldToEventLoop` whether the app is in the foreground, from React Native's AppState (that module stays free
 * of React Native so it runs under Vitest). Android fires no JavaScript timer out of the foreground, so a yield there
 * must not wait on one. Imported by the app's entry (index.js) for its side effect, before anything can yield; a
 * headless start (a background task in a killed process) reads "background" here.
 */
import { AppState } from 'react-native';

import { releaseWaitingYields, setForegroundCheck } from './yieldToEventLoop';

setForegroundCheck(() => AppState.currentState === 'active');

AppState.addEventListener('change', (state) => {
  if (state !== 'active') releaseWaitingYields();
});
