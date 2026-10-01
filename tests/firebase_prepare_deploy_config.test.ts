import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

const dirs: string[] = [];
const script = resolve(process.cwd(), 'scripts/prepare-firebase-deploy-config.mjs');

function fixture() {
  const dir = mkdtempSync(join(tmpdir(), 'logbook-firebase-deploy-'));
  dirs.push(dir);
  writeFileSync(join(dir, 'firebase.json'), JSON.stringify({
    firestore: { rules: 'firestore.rules' },
    hosting: {
      target: 'production',
      public: 'dist',
      headers: [{
        source: '!/__/**',
        headers: [{
          key: 'Content-Security-Policy',
          value: "default-src 'self'; connect-src 'self' https://logbook-function.invalid https://example.invalid;",
        }],
      }],
      rewrites: [{ source: '**', destination: '/index.html' }],
    },
  }), 'utf8');
  return dir;
}

function run(dir: string, overrides: Record<string, string> = {}) {
  execFileSync(process.execPath, [script], {
    cwd: dir,
    env: {
      ...process.env,
      FIREBASE_HOSTING_SITE: 'thelogbook',
      FIREBASE_PROJECT_ID: 'logbook-db-98cc4',
      FIREBASE_FUNCTION_REGION: 'europe-west1',
      VITE_ACCOUNT_DELETION_API_URL: 'https://europe-west1-logbook-db-98cc4.cloudfunctions.net/accountDeletion',
      ...overrides,
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  return JSON.parse(readFileSync(join(dir, '.firebase-deploy.json'), 'utf8'));
}

afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe('Firebase deploy config preparation', () => {
  it('binds the selected Hosting site and narrows CSP to the exact Function origin', () => {
    const config = run(fixture());
    expect(config.hosting.site).toBe('thelogbook');
    expect(config.hosting.target).toBeUndefined();

    const csp = config.hosting.headers[0].headers[0].value as string;
    expect(csp).toContain('https://europe-west1-logbook-db-98cc4.cloudfunctions.net');
    expect(csp).not.toContain('https://logbook-function.invalid');
    expect(csp).not.toContain('https://*.cloudfunctions.net');
  });

  it('fails closed when the account deletion endpoint is not a Cloud Functions URL', () => {
    const dir = fixture();
    expect(() => run(dir, {
      VITE_ACCOUNT_DELETION_API_URL: 'https://example.invalid/accountDeletion',
    })).toThrow();
  });

  it('fails closed when the Function endpoint belongs to another project or path', () => {
    expect(() => run(fixture(), {
      VITE_ACCOUNT_DELETION_API_URL: 'https://europe-west1-other-project.cloudfunctions.net/accountDeletion',
    })).toThrow();

    expect(() => run(fixture(), {
      VITE_ACCOUNT_DELETION_API_URL: 'https://europe-west1-logbook-db-98cc4.cloudfunctions.net/other',
    })).toThrow();
  });
});
