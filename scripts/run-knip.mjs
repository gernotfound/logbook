import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';

const require = createRequire(import.meta.url);
const knipEntry = require.resolve('knip');
const knipCli = resolve(dirname(knipEntry), '../bin/knip.js');

const result = spawnSync(process.execPath, [knipCli, ...process.argv.slice(2)], {
  stdio: 'inherit',
  env: {
    ...process.env,
    // Knip documents this escape hatch for constrained runtimes where
    // oxc-parser raw transfer may over-allocate shared buffers.
    KNIP_DISABLE_RAW_TRANSFER: '1',
  },
});

if (result.error) throw result.error;
process.exit(result.status ?? 1);
