import { mkdirSync, rmSync, writeFileSync } from 'node:fs';

const outputDirectory = 'vercel-backend-static';

rmSync(outputDirectory, { recursive: true, force: true });
mkdirSync(outputDirectory, { recursive: true });
writeFileSync(
  `${outputDirectory}/backend-only.txt`,
  'TheLogBook frontend is served by Firebase Hosting. This Vercel deployment contains only trusted backend functions, cron and legacy-origin routing.\n',
  'utf8',
);
