import { build, preview } from 'vite';
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { generateIcons } from './resize_icons.mjs';

const require = createRequire(import.meta.url);
// An E2E build must never inherit credentials or endpoints from .env.production.
Object.assign(process.env, {
  VITE_FIREBASE_API_KEY: 'dummy-key',
  VITE_FIREBASE_AUTH_DOMAIN: 'dummy-domain.firebaseapp.com',
  VITE_FIREBASE_PROJECT_ID: 'demo-logbook-audit',
  VITE_FIREBASE_STORAGE_BUCKET: 'dummy-bucket.appspot.com',
  VITE_FIREBASE_MESSAGING_SENDER_ID: '1234567890',
  VITE_FIREBASE_APP_ID: '1:1234567890:web:123456',
  VITE_FIREBASE_MEASUREMENT_ID: 'G-12345',
  VITE_FIREBASE_DATABASE_URL: 'https://demo-logbook-audit.firebaseio.com',
  VITE_RECAPTCHA_V3_SITE_KEY: 'dummy-recaptcha-key',
});

await generateIcons();
await build();
const server = await preview({ preview: { host: '127.0.0.1', port: 0, strictPort: true } });
try {
  const address = server.httpServer.address();
  if (!address || typeof address === 'string') throw new Error('Preview address unavailable');
  process.exitCode = await new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [require.resolve('@playwright/test/cli'), 'test', ...process.argv.slice(2)], {
      stdio: 'inherit',
      windowsHide: true,
      env: { ...process.env, LOGBOOK_TEST_URL: `http://127.0.0.1:${address.port}` },
    });
    child.once('error', reject);
    child.once('exit', code => resolve(code ?? 1));
  });
} finally {
  // Own the server in this process: Playwright's Windows taskkill fallback can hang in sandboxes.
  await new Promise((resolve, reject) => {
    server.httpServer.close(error => error ? reject(error) : resolve());
    server.httpServer.closeAllConnections();
  });
}
