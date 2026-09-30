import { mkdir, writeFile } from 'node:fs/promises';

function normalizedOrigin(raw) {
  if (!raw) return 'https://logbook.invalid';
  const parsed = new URL(raw);
  if (parsed.protocol !== 'https:') throw new Error('VITE_PUBLIC_ORIGIN deve usare HTTPS.');
  return parsed.origin;
}

const origin = normalizedOrigin(process.env.VITE_PUBLIC_ORIGIN);
await mkdir('dist', { recursive: true });
await writeFile('dist/robots.txt', `User-agent: *\nAllow: /\nSitemap: ${origin}/sitemap.xml\n`, 'utf8');
await writeFile(
  'dist/sitemap.xml',
  `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n  <url><loc>${origin}/</loc></url>\n</urlset>\n`,
  'utf8',
);
console.log(`Deployment metadata generated for ${origin}`);
