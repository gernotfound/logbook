import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const MANAGED_HEADER = '# As a condition of accessing this website, you agree to abide by the following\n';
const MANAGED_START = '# BEGIN Cloudflare Managed content\n';
const MANAGED_END = '# END Cloudflare Managed Content\n\n';
const MAX_MANAGED_PREFIX_BYTES = 8192;

// Cloudflare Bot Preference Sync prepends its own policy to the application's
// robots.txt. Permit only this bounded wrapper, preserving the original asset
// byte-for-byte as the trailing payload. Every other asset stays byte-exact.
export function matchesServedCloudflareAsset(pathname, expected, actual) {
  if (!Buffer.isBuffer(expected) || !Buffer.isBuffer(actual)) return false;
  if (actual.equals(expected)) return true;
  if (pathname !== '/robots.txt') return false;

  const prefixSize = actual.length - expected.length;
  if (prefixSize <= 0 || prefixSize > MAX_MANAGED_PREFIX_BYTES) return false;
  if (!actual.subarray(prefixSize).equals(expected)) return false;

  const prefixBytes = actual.subarray(0, prefixSize);
  const prefix = prefixBytes.toString('utf8');
  if (!Buffer.from(prefix, 'utf8').equals(prefixBytes) ||
      !prefix.startsWith(MANAGED_HEADER) || !prefix.endsWith(MANAGED_END)) return false;

  const start = prefix.indexOf(MANAGED_START);
  const end = prefix.indexOf(MANAGED_END);
  if (start < MANAGED_HEADER.length || end <= start ||
      prefix.indexOf(MANAGED_START, start + 1) !== -1 ||
      prefix.indexOf(MANAGED_END, end + 1) !== -1 ||
      end + MANAGED_END.length !== prefix.length) return false;

  const managedRules = prefix.slice(start + MANAGED_START.length, end);
  return managedRules.includes('User-agent: *\n') &&
    managedRules.includes('Content-Signal: search=yes,ai-train=no,use=reference\n');
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  if (process.argv.length !== 5) {
    console.error('Usage: node scripts/verify-cloudflare-served-asset.mjs PATH EXPECTED RECEIVED');
    process.exitCode = 2;
  } else {
    const [pathname, expectedFile, receivedFile] = process.argv.slice(2);
    try {
      if (matchesServedCloudflareAsset(pathname, readFileSync(expectedFile), readFileSync(receivedFile))) {
        console.log('Cloudflare asset verified:', pathname);
      } else {
        console.error('Cloudflare asset mismatch:', pathname);
        process.exitCode = 1;
      }
    } catch (error) {
      console.error('Cannot verify served Cloudflare asset:', error.message);
      process.exitCode = 1;
    }
  }
}
