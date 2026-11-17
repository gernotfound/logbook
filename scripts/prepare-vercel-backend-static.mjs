import { mkdirSync, rmSync, writeFileSync } from 'node:fs';

const outputDirectory = 'vercel-backend-static';

rmSync(outputDirectory, { recursive: true, force: true });
mkdirSync(outputDirectory, { recursive: true });
writeFileSync(
  `${outputDirectory}/backend-only.txt`,
  'TheLogBook frontend is migrating to Cloudflare. This Vercel deployment contains trusted backend functions and cron only; it does not serve the PWA.\n',
  'utf8',
);
