import { build, preview } from 'vite';
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { generateIcons } from './resize_icons.mjs';
import { createIsolatedE2eEnvironment } from './e2e-environment.mjs';
import { withSafariCIWorkers } from './e2e-safari-workers.mjs';

const require = createRequire(import.meta.url);
// Suppress inherited VITE_*, secrets and deployment flags before Vite runs.
const safeEnvironment = createIsolatedE2eEnvironment(process.env);
for (const key of Object.keys(process.env)) {
  if (!(key in safeEnvironment)) delete process.env[key];
}
Object.assign(process.env, safeEnvironment);

const nextDirectory = await mkdtemp(join(tmpdir(), 'logbook-e2e-next-'));
const servers = [];
const nextVersion = `${require('../package.json').version}-e2e-next`;
const origin = server => {
  const address = server.httpServer.address();
  if (!address || typeof address === 'string') throw new Error('Preview address unavailable');
  return `http://127.0.0.1:${address.port}`;
};
try {
  await generateIcons();
  await build({ envDir: false });
  // Two genuine production bundles generate distinct precache manifests.
  // Only the release label changes; both use this candidate's code and dummy
  // Firebase configuration. The alternate bundle never replaces dist/.
  await build({
    envDir: false,
    define: { __APP_VERSION__: JSON.stringify(nextVersion) },
    build: { outDir: nextDirectory, emptyOutDir: true },
  });
  servers.push(await preview({ preview: { host: '127.0.0.1', port: 0, strictPort: true } }));
  servers.push(await preview({
    build: { outDir: nextDirectory },
    preview: { host: '127.0.0.1', port: 0, strictPort: true },
  }));
  process.exitCode = await new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [require.resolve('@playwright/test/cli'), 'test', ...withSafariCIWorkers(process.argv.slice(2), Boolean(process.env.CI))], {
      stdio: 'inherit',
      windowsHide: true,
      env: {
        ...process.env,
        LOGBOOK_TEST_URL: origin(servers[0]),
        LOGBOOK_E2E_NEXT_URL: origin(servers[1]),
        LOGBOOK_E2E_NEXT_VERSION: nextVersion,
      },
    });
    child.once('error', reject);
    child.once('exit', code => resolve(code ?? 1));
  });
} finally {
  // Own the servers in this process: Playwright's Windows taskkill fallback can hang in sandboxes.
  try {
    await Promise.all(servers.map(server => new Promise((resolve, reject) => {
      server.httpServer.close(error => error ? reject(error) : resolve());
      server.httpServer.closeAllConnections();
    })));
  } finally {
    await rm(nextDirectory, { recursive: true, force: true });
  }
}
