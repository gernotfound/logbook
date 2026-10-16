import { build, preview } from 'vite';
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { generateIcons } from './resize_icons.mjs';
import { createIsolatedE2eEnvironment } from './e2e-environment.mjs';

const require = createRequire(import.meta.url);
// Suppress inherited VITE_*, secrets and deployment flags before Vite runs.
const safeEnvironment = createIsolatedE2eEnvironment(process.env);
for (const key of Object.keys(process.env)) {
  if (!(key in safeEnvironment)) delete process.env[key];
}
Object.assign(process.env, safeEnvironment);

await generateIcons();
await build({ envDir: false });
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
