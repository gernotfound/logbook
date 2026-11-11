import { readFileSync, writeFileSync, copyFileSync, existsSync } from 'node:fs';
import { spawnSync } from 'node:child_process';

const value = process.env.CLOUDFLARE_APP_ORIGIN;
if (!value) throw new Error('CLOUDFLARE_APP_ORIGIN is required');
const origin = new URL(value);
if (origin.protocol !== 'https:' || origin.origin !== value || origin.pathname !== '/' ||
    origin.search || origin.hash || origin.username || origin.password) {
  throw new Error('CLOUDFLARE_APP_ORIGIN must be a bare HTTPS origin, without trailing slash');
}
if (process.env.VITE_FIREBASE_AUTH_DOMAIN && process.env.VITE_FIREBASE_AUTH_DOMAIN !== origin.hostname) {
  throw new Error('Firebase authDomain must match the Cloudflare origin hostname');
}
const build = spawnSync('npm', ['run', 'build'], {
  env: { ...process.env, VITE_FIREBASE_AUTH_DOMAIN: origin.hostname },
  stdio: 'inherit',
});
if (build.error) throw build.error;
if (build.status !== 0) process.exit(build.status || 1);

// Only SEO files are changed after build. index.html is transformed by Vite
// before Workbox computes the app-shell precache revision.
for (const file of ['robots.txt', 'sitemap.xml']) {
  const path = 'dist/' + file;
  const content = readFileSync(path, 'utf8');
  if (!content.includes('https://thelogbook.web.app/')) throw new Error('SEO marker missing in ' + file);
  writeFileSync(path, content.replaceAll('https://thelogbook.web.app/', value + '/'));
}
copyFileSync('cloudflare/_headers', 'dist/_headers');
for (const file of ['index.html', 'sw.js', 'manifest.webmanifest', 'robots.txt', 'sitemap.xml', '_headers']) {
  if (!existsSync('dist/' + file)) throw new Error('Cloudflare artifact missing ' + file);
}
const html = readFileSync('dist/index.html', 'utf8');
if (!html.includes('rel="canonical" href="' + value + '/"') || html.includes('https://thelogbook.web.app/')) {
  throw new Error('Cloudflare app shell canonical origin incorrect');
}
console.log('Cloudflare static assets prepared with same-origin Firebase Auth');
