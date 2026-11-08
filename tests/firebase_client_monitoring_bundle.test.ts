import { expect, it } from 'vitest';
import { assertNoBundledClientDiagnostics } from '../vite.config';

it('allows only the ordinary Firebase client SDK and inert OpenTelemetry API', () => {
  expect(() => assertNoBundledClientDiagnostics([
    '/work/node_modules/@firebase/auth/dist/esm/index.esm.js',
    '/work/node_modules/@firebase/firestore/dist/index.esm.js',
    '/work/node_modules/firebase/app/dist/index.esm.js',
    '/work/node_modules/@opentelemetry/api/build/esm/index.js',
    '/work/src/lib/firebase.ts',
  ])).not.toThrow();
});

it.each([
  '/work/node_modules/@firebase/crashlytics/dist/index.esm.js',
  '/work/node_modules/firebase/crashlytics/dist/index.js',
  '/work/node_modules/@opentelemetry/browser-instrumentation/build/index.js',
  '/work/node_modules/@opentelemetry/exporter-logs-otlp-http/build/index.js',
  '/work/node_modules/@opentelemetry/instrumentation-fetch/build/index.js',
  '/work/node_modules/@opentelemetry/sdk-trace-web/build/index.js',
  'C:\\work\\node_modules\\@firebase\\crashlytics\\dist\\index.js',
  '/work/node_modules/mixed/node_modules/@opentelemetry/sdk-logs/build/index.js',
])('rejects diagnostic SDK module in generated bundle: %s', id => {
  expect(() => assertNoBundledClientDiagnostics([id])).toThrow(
    /External client error monitoring module forbidden in production bundle/,
  );
});

it('also rejects the diagnostic module when mixed with ordinary chunks', () => {
  expect(() => assertNoBundledClientDiagnostics([
    '/work/node_modules/firebase/auth/dist/index.js',
    '/work/node_modules/@firebase/crashlytics/dist/index.js',
    '/work/node_modules/firebase/firestore/dist/index.js',
  ])).toThrow(/@firebase\/crashlytics/);
});
