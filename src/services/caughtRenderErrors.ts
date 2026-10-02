/**
 * A render error that an error boundary caught (AppError, the root layout's `ErrorBoundary`) is logged by that
 * boundary in fixed words and a code (`describeForLog`), and by nothing else in a release build.
 *
 * React Native's renderer hands every caught error to `ExceptionsManager.handleException(error, false)`, which
 * writes the error, message and component stack included, to `console.error` and reports it to the native
 * exceptions manager; a release build puts both in the device log. A message can quote a local id, a server URL or
 * a server's own words (pre-launch review L7), so a release build drops that report for caught component errors.
 * Uncaught errors (fatal) go through as before, and a development build keeps LogBox's report of every error.
 */

/** The part of `react-native/Libraries/Core/ExceptionsManager` this replaces. */
interface ExceptionsManagerLike {
  handleException: (error: unknown, isFatal: boolean) => void;
}

let installed = false;

/** Whether React Native would report this error as one an error boundary caught. */
export function isCaughtComponentError(error: unknown, isFatal: boolean): boolean {
  return (
    !isFatal &&
    typeof error === 'object' &&
    error !== null &&
    (error as { isComponentError?: unknown }).isComponentError === true
  );
}

/** Release builds only (the root layout calls it once): drops React Native's own report of a caught render error. */
export function quietCaughtRenderErrors(): void {
  if (installed) return;
  installed = true;
  // React Native's own module, the one its renderer's onCaughtError calls into (no public API reaches it).
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const manager = require('react-native/Libraries/Core/ExceptionsManager')
    .default as ExceptionsManagerLike;
  const report = manager.handleException;
  manager.handleException = (error, isFatal) => {
    if (isCaughtComponentError(error, isFatal)) return;
    report(error, isFatal);
  };
}
