import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

export const TEST_FIREBASE_PROJECT = 'thelogbook-test';
export const TEST_HOSTING_SITE = 'thelogbook-test';
const TEST_CONFIG_PATH = '.firebase.test.local.json';
const PRODUCTION_BACKEND_ORIGIN = 'https://logbook-gnf.vercel.app';
const TEST_BACKEND_ORIGIN = 'https://thelogbook-test-backend-gnfcreator.vercel.app';
const PRODUCTION_AUTH_FRAME = 'https://logbook-db-98cc4.firebaseapp.com';
const TEST_AUTH_FRAME = 'https://thelogbook-test.firebaseapp.com';

function testContentSecurityPolicy(value) {
  assert.equal(typeof value, 'string', 'Missing canonical Hosting Content-Security-Policy');
  let connectCount = 0;
  let frameCount = 0;
  const directives = value.split(';').map(part => part.trim()).filter(Boolean).map(part => {
    const [name, ...tokens] = part.split(/\s+/);
    if (name === 'connect-src') {
      connectCount++;
      assert.equal(tokens.filter(token => token === PRODUCTION_BACKEND_ORIGIN).length, 1,
        'Canonical CSP must contain exactly one Production backend origin');
      assert.ok(!tokens.includes(TEST_BACKEND_ORIGIN),
        'Test backend origin must not appear in canonical Production CSP');
      const testTokens = tokens
        .filter(token => !/^https:\/\/[a-z0-9-]+\.ingest\.[a-z0-9-]+\.sentry\.io$/.test(token))
        .map(token => token === PRODUCTION_BACKEND_ORIGIN ? TEST_BACKEND_ORIGIN : token);
      return [name, ...testTokens].join(' ');
    }
    if (name === 'frame-src') {
      frameCount++;
      assert.equal(tokens.filter(token => token === PRODUCTION_AUTH_FRAME).length, 1,
        'Canonical CSP must contain exactly one Production Firebase Auth frame origin');
      assert.ok(!tokens.includes(TEST_AUTH_FRAME),
        'Test Auth frame origin must not appear in canonical Production CSP');
      return [name, ...tokens.map(token =>
        token === PRODUCTION_AUTH_FRAME ? TEST_AUTH_FRAME : token)].join(' ');
    }
    return part;
  });
  assert.equal(connectCount, 1, 'Expected one connect-src directive');
  assert.equal(frameCount, 1, 'Expected one frame-src directive');
  const result = directives.join('; ') + ';';
  assert.ok(!result.includes(PRODUCTION_BACKEND_ORIGIN));
  assert.ok(!result.includes(PRODUCTION_AUTH_FRAME));
  assert.ok(!result.includes('.sentry.io'), 'Test CSP must not contact Production Sentry');
  return result;
}


export function testFirebaseConfig(source, projectId) {
  assert.equal(projectId, TEST_FIREBASE_PROJECT,
    'Refusing to prepare Firebase config for anything other than the dedicated Test project');
  assert.equal(source?.hosting?.site, 'thelogbook',
    'Expected the canonical Production Hosting site in the source config');
  assert.equal(source?.hosting?.public, 'dist');
  assert.equal(source?.firestore?.rules, 'firestore.rules');
  assert.equal(source?.firestore?.indexes, 'firestore.indexes.json');
  assert.deepEqual(source.hosting.rewrites, [{ source: '**', destination: '/index.html' }]);
  assert.equal(source.functions, undefined, 'Unexpected Firebase Functions config');
  assert.ok(Array.isArray(source.hosting.headers), 'Missing canonical Hosting headers');
  let cspCount = 0;
  const headers = source.hosting.headers.map(route => ({
    ...route,
    headers: route.headers.map(header => {
      if (header.key !== 'Content-Security-Policy') return header;
      assert.equal(route.source, '/**', 'CSP must be applied to every Test Hosting path');
      cspCount++;
      return { ...header, value: testContentSecurityPolicy(header.value) };
    }),
  }));
  assert.equal(cspCount, 1, 'Expected exactly one canonical Hosting CSP');
  return { ...source, hosting: { ...source.hosting, site: TEST_HOSTING_SITE, headers } };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const source = JSON.parse(readFileSync('firebase.json', 'utf8'));
  const config = testFirebaseConfig(source, process.argv[2]);
  writeFileSync(TEST_CONFIG_PATH, JSON.stringify(config, null, 2) + '\n', { flag: 'w', mode: 0o600 });
  console.log('Prepared temporary Firebase Hosting / Firestore config for thelogbook-test only.');
}
