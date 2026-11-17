import test from 'node:test';
import assert from 'node:assert/strict';
import { rewriteCloudflareSeo, assertCloudflareHtmlOrigin } from '../../scripts/cloudflare-seo.mjs';

const target = 'https://thelogbook.example';
const robots = 'User-agent: *\nAllow: /\n\nSitemap: https://thelogbook.web.app/sitemap.xml\n';
const sitemap = '<?xml version="1.0"?><urlset><url><loc>https://thelogbook.web.app/</loc></url></urlset>';

void test('rebase only the exact known SEO URLs', () => {
  assert.equal(rewriteCloudflareSeo('robots.txt', robots, target),
    'User-agent: *\nAllow: /\n\nSitemap: https://thelogbook.example/sitemap.xml\n');
  assert.equal(rewriteCloudflareSeo('sitemap.xml', sitemap, target),
    '<?xml version="1.0"?><urlset><url><loc>https://thelogbook.example/</loc></url></urlset>');
});

void test('reject lookalike hosts, embedded URLs and multiple canonical records', () => {
  for (const candidate of [
    'https://thelogbook.web.app.evil.example/sitemap.xml',
    'https://evil.example/?next=https://thelogbook.web.app/sitemap.xml',
    'https://thelogbook.web.app@evil.example/sitemap.xml',
  ]) {
    assert.throws(() => rewriteCloudflareSeo('robots.txt', 'Sitemap: ' + candidate + '\n', target));
  }
  assert.throws(() => rewriteCloudflareSeo('robots.txt', robots + robots, target));
  assert.throws(() => rewriteCloudflareSeo('sitemap.xml', '<loc>https://evil.example/?next=https://thelogbook.web.app/</loc>', target));
  assert.throws(() => rewriteCloudflareSeo('sitemap.xml', sitemap + sitemap, target));
  assert.throws(() => rewriteCloudflareSeo('robots.txt', robots, 'http://thelogbook.example'));
});

void test('validate parsed HTML canonical and reject remaining old-origin attributes', () => {
  const valid = '<link rel="canonical" href="https://thelogbook.example/"><meta property="og:image" content="https://thelogbook.example/image.png">';
  assert.doesNotThrow(() => assertCloudflareHtmlOrigin(valid, target));
  assert.throws(() => assertCloudflareHtmlOrigin(valid.replace('thelogbook.example/', 'thelogbook.web.app/'), target));
  assert.throws(() => assertCloudflareHtmlOrigin(valid + '<meta content="https://thelogbook.web.app/icon.png">', target));
  assert.doesNotThrow(() => assertCloudflareHtmlOrigin(valid + '<meta content="https://other.example/?next=https://thelogbook.web.app/">', target));
});
