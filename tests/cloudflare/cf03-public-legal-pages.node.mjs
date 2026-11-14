import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const about = readFileSync('public/about.html', 'utf8');
const privacy = readFileSync('public/privacy.html', 'utf8');
const css = readFileSync('public/legal-pages.css', 'utf8');
const sw = readFileSync('src/sw.ts', 'utf8');
const config = JSON.parse(readFileSync('cloudflare/wrangler.jsonc', 'utf8'));

void test('public documents are static, correctly labeled and linked for Google OAuth', () => {
  for (const [route, html] of [['about', about], ['privacy', privacy]]) {
    assert.match(html, /<!doctype html>/i, route);
    assert.match(html, /<html lang="it">/, route);
    assert.ok(html.includes('rel="canonical" href="https://thelogbook.me/' + route + '"'), route);
    assert.match(html, /<main id="contenuto">/, route);
    assert.match(html, /href="\/legal-pages.css"/, route);
    assert.doesNotMatch(html, /<script\b|<form\b|https?:\/\/[^" ]+\.js/i, route);
  }
  assert.match(about, /href="\/privacy">Informativa sulla privacy/);
  assert.match(about, /Allenamenti, alimentazione e progressi/);
  assert.match(privacy, /identificatore univoco/);
  assert.match(privacy, /Google Sign-In/);
  assert.match(privacy, /Kinde/);
  assert.match(privacy, /Firebase Authentication/);
  assert.match(privacy, /non vengono venduti/);
  assert.match(privacy, /thelogbook\.privacy@gmail\.com/);
  assert.doesNotMatch(css, /@import|url\(https?:|javascript:/i);
});

void test('public pages bypass Workers API and unknown paths remain 404', () => {
  assert.equal(config.assets.not_found_handling, '404-page');
  assert.equal(config.assets.html_handling ?? 'auto-trailing-slash', 'auto-trailing-slash');
  assert.deepEqual(config.assets.run_worker_first, ['/__/auth', '/__/auth/*']);
  assert.equal(config.workers_dev, false);
  assert.equal(config.preview_urls, false);
});

void test('PWA navigation fallback excludes both public documents', () => {
  const denylist = sw.match(/denylist:\s*\[([^\]]*)\]/)?.[1] ?? '';
  assert.ok(denylist.includes("/^\\/__\\//"), 'Firebase Auth helper exclusion must remain');
  assert.ok(denylist.includes("/^\\/(?:about|privacy)(?:\\/|\\.html|$)/"), 'public legal page exclusion must remain');
  assert.match(sw, /createHandlerBoundToURL\('\/index\.html'\)/);
});
