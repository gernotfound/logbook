import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';

const source = readFileSync(new URL('../../public/analytics-loader.js', import.meta.url), 'utf8');
const index = readFileSync(new URL('../../index.html', import.meta.url), 'utf8');
const about = readFileSync(new URL('../../public/about.html', import.meta.url), 'utf8');
const privacy = readFileSync(new URL('../../public/privacy.html', import.meta.url), 'utf8');
const diagnostic = readFileSync(new URL('../../public/verifica-accesso.html', import.meta.url), 'utf8');
const headers = readFileSync(new URL('../../cloudflare/_headers', import.meta.url), 'utf8');
const inAppPrivacy = readFileSync(new URL('../../src/pages/PrivacyPolicy.tsx', import.meta.url), 'utf8');
const analyticsRules = readFileSync(new URL('../../.agents/rules/telemetry-and-privacy.md', import.meta.url), 'utf8');
const externalServicesRules = readFileSync(new URL('../../.agents/rules/external-services.md', import.meta.url), 'utf8');

function scriptsFor(url, options = {}) {
  const collected = [];
  const window = {
    location: new URL(url),
    navigator: { doNotTrack: options.dnt || '0', globalPrivacyControl: !!options.gpc },
  };
  const document = {
    referrer: options.referrer || '',
    createElement(tag) {
      assert.equal(tag, 'script');
      return { setAttribute(name, value) { this[name] = value; } };
    },
    head: { appendChild(element) { collected.push(element); } },
  };
  runInNewContext(source, { window, document, URL, Set, JSON });
  return collected;
}
void test('the reviewed manual beacon is limited to known public no-query paths', () => {
  for (const path of ['/', '/index.html']) {
    const scripts = scriptsFor('https://thelogbook.me' + path);
    assert.equal(scripts.length, 1);
    assert.equal(scripts[0].src, 'https://static.cloudflareinsights.com/beacon.min.js');
    assert.equal(scripts[0].referrerPolicy, 'no-referrer');
    assert.deepEqual(JSON.parse(scripts[0]['data-cf-beacon']), {
      token: 'c375a573603f448f87a2d1b14cfc540e', spa: false,
    });
  }
});
void test('no beacon on OAuth, health, query, fragments, other origins and HTTP', () => {
  for (const url of [
    'https://thelogbook.me/?tab=training',
    'https://thelogbook.me/?code=secret&state=secret',
    'https://thelogbook.me/#secret',
    'https://thelogbook.me/privacy',
    'https://thelogbook.me/about',
    'https://thelogbook.me/verifica-accesso',
    'https://thelogbook.me/api/auth/kinde/callback?code=secret',
    'https://thelogbook.me/training',
    'https://thelogbook.me.evil.test/',
    'https://other.example/',
    'http://thelogbook.me/',
  ]) assert.equal(scriptsFor(url).length, 0, url);
});
void test('no beacon when a sensitive referrer could be forwarded', () => {
  for (const referrer of [
    'https://thelogbook.me/api/auth/kinde/callback?code=secret',
    'https://thelogbook.me/verifica-accesso',
    'https://thelogbook.me/about?token=secret',
    'https://thelogbook.me/about',
    'https://example.org/sensitive/path',
    'https://example.org/?code=secret',
  ]) assert.equal(scriptsFor('https://thelogbook.me/', { referrer }).length, 0, referrer);
  assert.equal(scriptsFor('https://thelogbook.me/', { referrer: 'https://thelogbook.me/index.html' }).length, 1);
});
void test('respects DNT and GPC', () => {
  assert.equal(scriptsFor('https://thelogbook.me/', { dnt: '1' }).length, 0);
  assert.equal(scriptsFor('https://thelogbook.me/', { gpc: true }).length, 0);
});
void test('source and CSP enforce explicit manual installation, excluding auth and privacy', () => {
  assert.ok(index.includes('<script defer src="/analytics-loader.js"></script>'));
  assert.ok(!about.includes('analytics-loader.js'));
  assert.ok(!privacy.includes('analytics-loader.js') && !diagnostic.includes('analytics-loader.js'));
  assert.ok(headers.includes("script-src 'self' https://static.cloudflareinsights.com "));
  assert.ok(headers.includes("connect-src 'self' https://cloudflareinsights.com "));
});

void test('public and in-app privacy policies accurately disclose the reviewed Cloudflare analytics boundary', () => {
  assert.match(privacy, /Cloudflare Web Analytics/);
  assert.match(privacy, /privacy/i);
  assert.match(privacy, /sette giorni/);
  assert.match(privacy, /sei mesi/);
  assert.match(inAppPrivacy, /Cloudflare Web Analytics/);
  assert.match(inAppPrivacy, /Do Not Track\/Global Privacy Control/);
  assert.doesNotMatch(inAppPrivacy, /non integra servizi di analytics di utilizzo/);
  assert.match(analyticsRules, /non supporta eventi personalizzati/);
  assert.match(analyticsRules, /SRI\/version pinning/);
  assert.match(privacy, /isolata dalle schermate/);
  assert.match(inAppPrivacy, /codice esterno non rimanga eseguibile/);
  assert.match(externalServicesRules, /Cloudflare Web Analytics Free/);
});
