import { createHash } from 'node:crypto';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const TOOLSETS = {
  'linux-x64': {
    gitleaks: { version: '8.30.1', url: 'https://github.com/gitleaks/gitleaks/releases/download/v8.30.1/gitleaks_8.30.1_linux_x64.tar.gz', assetApiUrl: 'https://api.github.com/repos/gitleaks/gitleaks/releases/assets/378332058', sha256: '551f6fc83ea457d62a0d98237cbad105af8d557003051f41f3e7ca7b3f2470eb', archive: 'gitleaks.tar.gz', binary: 'gitleaks' },
    zizmor: { version: '1.30.1', url: 'https://github.com/zizmorcore/zizmor/releases/download/v1.30.1/zizmor-x86_64-unknown-linux-gnu.tar.gz', assetApiUrl: 'https://api.github.com/repos/zizmorcore/zizmor/releases/assets/552067642', sha256: 'e65324f4430c2717591937edcec90ccbefaf14c174f8ec9415e03ca875b46e1a', archive: 'zizmor.tar.gz', binary: 'zizmor' },
  },
  'win32-x64': {
    gitleaks: { version: '8.30.1', url: 'https://github.com/gitleaks/gitleaks/releases/download/v8.30.1/gitleaks_8.30.1_windows_x64.zip', assetApiUrl: 'https://api.github.com/repos/gitleaks/gitleaks/releases/assets/378333178', sha256: 'd29144deff3a68aa93ced33dddf84b7fdc26070add4aa0f4513094c8332afc4e', archive: 'gitleaks.zip', binary: 'gitleaks.exe' },
    zizmor: { version: '1.30.1', url: 'https://github.com/zizmorcore/zizmor/releases/download/v1.30.1/zizmor-x86_64-pc-windows-msvc.zip', assetApiUrl: 'https://api.github.com/repos/zizmorcore/zizmor/releases/assets/552067645', sha256: 'b183b1e996eddfab9659f1e9b46e059f1ef1cf984a1f14e5da09f7876a4b3a1c', archive: 'zizmor.zip', binary: 'zizmor.exe' },
  },
};

class ToolFailure extends Error {
  constructor(tool, status) {
    super(`${tool} exited with status ${status}`);
    this.status = status;
  }
}

function run(command, args) {
  const result = spawnSync(command, args, { stdio: 'inherit', windowsHide: true });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new ToolFailure(command, result.status ?? 1);
}

function resolveCommit(ref) {
  if (!ref) return null;
  const result = spawnSync('git', ['rev-parse', '--verify', `${ref}^{commit}`], { encoding: 'utf8', windowsHide: true });
  return result.status === 0 ? result.stdout.trim() : null;
}

export function scanRange() {
  const requested = process.env.GITLEAKS_BASE_SHA?.trim();
  if (requested) {
    const base = resolveCommit(requested);
    // A missing requested base must not silently narrow the security scan to HEAD^.
    if (!base) throw new Error('Unable to resolve the requested Gitleaks base commit.');
    return `${base}..HEAD`;
  }
  const base = resolveCommit('HEAD^');
  if (!base) throw new Error('Unable to resolve a Git base commit for Gitleaks.');
  return `${base}..HEAD`;
}

// The release page and the official asset API serve the same pinned archive.
// Retry only transfer failures; a checksum mismatch must never be recoverable.
export async function fetchVerifiedToolArchive(tool, request = fetch) {
  const sources = [
    { url: tool.url },
    ...(tool.assetApiUrl ? [{
      url: tool.assetApiUrl,
      headers: { Accept: 'application/octet-stream', 'X-GitHub-Api-Version': '2022-11-28' },
    }] : []),
  ];
  for (let index = 0; index < sources.length; index += 1) {
    const source = sources[index];
    let response;
    try {
      response = await request(source.url, {
        redirect: 'follow',
        ...(source.headers ? { headers: source.headers } : {}),
      });
    } catch (error) {
      if (index + 1 === sources.length) throw error;
      console.warn(`Release download unavailable for ${tool.binary}; retrying official GitHub asset API.`);
      continue;
    }
    if (!response.ok) {
      if (index + 1 < sources.length && [500, 502, 503, 504].includes(response.status)) {
        console.warn(`Release download HTTP ${response.status} for ${tool.binary}; retrying official GitHub asset API.`);
        continue;
      }
      throw new Error(`Unable to download ${tool.binary} ${tool.version}: HTTP ${response.status}`);
    }
    const bytes = Buffer.from(await response.arrayBuffer());
    const digest = createHash('sha256').update(bytes).digest('hex');
    if (digest !== tool.sha256) throw new Error(`${tool.binary} ${tool.version} checksum mismatch`);
    return bytes;
  }
  throw new Error(`Unable to download ${tool.binary} ${tool.version} from official release sources`);
}

async function installTool(tool, root) {
  const archivePath = join(root, tool.archive);
  const bytes = await fetchVerifiedToolArchive(tool);
  await writeFile(archivePath, bytes);
  run('tar', [tool.archive.endsWith('.tar.gz') ? '-xzf' : '-xf', archivePath, '-C', root]);
  return join(root, tool.binary);
}

async function main() {
  // Keep the guarded npm script unchanged: run scanner regressions here before
  // installing external tools so the canonical security gate stays intact.
  run(process.execPath, ['--test', fileURLToPath(new URL('./run-security-static-regressions.mjs', import.meta.url))]);
  const platformKey = `${process.platform}-${process.arch}`;
  const toolset = TOOLSETS[platformKey];
  if (!toolset) throw new Error(`Unsupported platform for static security gate: ${platformKey}`);

  const root = await mkdtemp(join(tmpdir(), 'logbook-security-'));
  try {
    const gitleaks = await installTool(toolset.gitleaks, root);
    const zizmor = await installTool(toolset.zizmor, root);
    const range = scanRange();

    console.log(`Gitleaks ${toolset.gitleaks.version}: scanning ${range} with fully redacted findings.`);
    run(gitleaks, ['git', '--no-banner', '--redact=100', `--log-opts=${range}`, '.']);

    console.log(`zizmor ${toolset.zizmor.version}: auditing GitHub Actions workflows.`);
    run(zizmor, ['--format', 'plain', '--no-progress', '--color', 'never', '.github/workflows']);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch(error => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = error instanceof ToolFailure ? error.status : 1;
  });
}
