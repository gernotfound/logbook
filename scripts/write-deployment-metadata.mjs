import { mkdir, writeFile } from 'node:fs/promises';

function normalizedOrigin(raw) {
  if (!raw) return 'https://logbook.invalid';
  const parsed = new URL(raw);
  if (parsed.protocol !== 'https:') throw new Error('VITE_PUBLIC_ORIGIN deve usare HTTPS.');
  return parsed.origin;
}

const configuredOrigin = process.env.VITE_PUBLIC_ORIGIN?.trim();
const vercelProductionHost = process.env.VERCEL_PROJECT_PRODUCTION_URL?.trim();
const buildSha = (
  process.env.LOGBOOK_BUILD_SHA
  || process.env.EXPECTED_SHA
  || process.env.GITHUB_SHA
  || process.env.VERCEL_GIT_COMMIT_SHA
  || 'dev'
).trim();
const origin = normalizedOrigin(
  configuredOrigin || (vercelProductionHost ? `https://${vercelProductionHost}` : undefined),
);
await mkdir('dist', { recursive: true });
await writeFile('dist/robots.txt', `User-agent: *\nAllow: /\nSitemap: ${origin}/sitemap.xml\n`, 'utf8');
await writeFile(
  'dist/sitemap.xml',
  `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n  <url><loc>${origin}/</loc></url>\n</urlset>\n`,
  'utf8',
);
await writeFile(
  'dist/migration-ready.json',
  JSON.stringify({ version: 1, buildSha, origin }) + '\n',
  'utf8',
);
console.log(`Deployment metadata generated for ${origin} at ${buildSha}`);
