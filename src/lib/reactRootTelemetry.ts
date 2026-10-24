import type { RootOptions } from 'react-dom/client';
import { telemetryHub } from './telemetryHub';

/** Production React root error handlers, also exercised through a real React root. */
export function createReactRootTelemetryOptions(): RootOptions {
  return {
    onCaughtError(error, errorInfo) {
      telemetryHub.trackError(error, {
        source: 'react_caught',
        componentStack: errorInfo?.componentStack,
      });
    },
    onUncaughtError(error, errorInfo) {
      telemetryHub.trackError(error, {
        source: 'react_uncaught',
        componentStack: errorInfo?.componentStack,
      });
    },
    onRecoverableError(error, errorInfo) {
      telemetryHub.trackError(error, {
        source: 'react_recoverable',
        componentStack: errorInfo?.componentStack,
      });
    },
  };
}
