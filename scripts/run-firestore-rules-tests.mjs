import { spawn, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { createReadStream, createWriteStream, existsSync, mkdirSync, readFileSync, renameSync, rmSync, statSync } from 'node:fs';
import net from 'node:net';
import { homedir } from 'node:os';
import path from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';

const PROJECT_ID = 'demo-logbook-audit';
const config = JSON.parse(readFileSync(path.resolve('firebase.emulator.json'), 'utf8'));
const HOST = config.emulators.firestore.host;
const PORT = config.emulators.firestore.port;
const RULES_PATH = path.resolve(config.firestore.rules);
const SINGLE_PROJECT_MODE = String(config.emulators.singleProjectMode ?? true);
const VERSION = '1.22.0';
const SIZE = 136707194;
const SHA256 = '9b6498b7f62714d67f48f59b3818883cd682dbcd46b9f59511de81c97bb5166c';
const URL = `https://storage.googleapis.com/firebase-preview-drop/emulator/cloud-firestore-emulator-v${VERSION}.jar`;

const cacheDir = process.env.LOGBOOK_FIRESTORE_EMULATOR_CACHE
  || path.join(homedir(), '.cache', 'logbook', 'emulators');
const jarPath = path.join(cacheDir, `cloud-firestore-emulator-v${VERSION}.jar`);
const tempPath = `${jarPath}.download`;

async function sha256(filePath) {
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(filePath)) hash.update(chunk);
  return hash.digest('hex');
}

async function validJar(filePath) {
  return existsSync(filePath)
    && statSync(filePath).size === SIZE
    && await sha256(filePath) === SHA256;
}

async function ensureEmulator() {
  mkdirSync(cacheDir, { recursive: true });
  if (await validJar(jarPath)) return;
  rmSync(tempPath, { force: true });
  const response = await fetch(URL, { redirect: 'follow' });
  if (!response.ok || !response.body) {
    throw new Error(`Firestore emulator download failed: HTTP ${response.status}`);
  }
  await pipeline(Readable.fromWeb(response.body), createWriteStream(tempPath));
  if (!await validJar(tempPath)) {
    rmSync(tempPath, { force: true });
    throw new Error('Firestore emulator download failed checksum/size verification');
  }
  renameSync(tempPath, jarPath);
}

function portOpen() {
  return new Promise(resolve => {
    const socket = net.createConnection({ host: HOST, port: PORT });
    const done = value => {
      socket.destroy();
      resolve(value);
    };
    socket.once('connect', () => done(true));
    socket.once('error', () => done(false));
    socket.setTimeout(500, () => done(false));
  });
}

async function waitUntilReady(child) {
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) {
      throw new Error(`Firestore emulator exited early with code ${child.exitCode}`);
    }
    if (await portOpen()) return;
    await new Promise(resolve => setTimeout(resolve, 200));
  }
  throw new Error('Firestore emulator did not become ready within 30 seconds');
}

function stopProcess(child) {
  if (!child || child.exitCode !== null) return;
  child.kill('SIGTERM');
  if (process.platform === 'win32' && child.pid) {
    spawnSync('taskkill', ['/pid', String(child.pid), '/t', '/f'], { stdio: 'ignore' });
  }
}

await ensureEmulator();
if (await portOpen()) {
  throw new Error(`Port ${PORT} is already in use; refusing to attach to an unknown emulator`);
}

const emulatorLog = createWriteStream(path.resolve('firestore-debug.log'));
const emulator = spawn('java', [
  '-Dgoogle.cloud_firestore.debug_log_level=FINE',
  '-Duser.language=en',
  '-jar', jarPath,
  '--host', HOST,
  '--port', String(PORT),
  '--rules', RULES_PATH,
  '--project_id', PROJECT_ID,
  '--single_project_mode', SINGLE_PROJECT_MODE,
], { stdio: ['ignore', 'pipe', 'pipe'] });
emulator.stdout.pipe(emulatorLog, { end: false });
emulator.stderr.pipe(emulatorLog, { end: false });

try {
  await waitUntilReady(emulator);
  const vitest = path.resolve('node_modules', 'vitest', 'vitest.mjs');
  const tests = spawn(process.execPath, [vitest, 'run', '--config', 'vitest.emulator.config.ts'], {
    stdio: 'inherit',
    env: {
      ...process.env,
      FIRESTORE_EMULATOR_HOST: `${HOST}:${PORT}`,
      GCLOUD_PROJECT: PROJECT_ID,
    },
  });
  const exitCode = await new Promise((resolve, reject) => {
    tests.once('error', reject);
    tests.once('exit', code => resolve(code ?? 1));
  });
  if (exitCode !== 0) process.exitCode = exitCode;
} finally {
  stopProcess(emulator);
  emulatorLog.end();
}
