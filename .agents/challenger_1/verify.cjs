const fs = require('fs');
const path = require('path');

const agentsPath = path.resolve(__dirname, '../../AGENTS.md');
const content = fs.readFileSync(agentsPath, 'utf8');

console.log('Read AGENTS.md length:', content.length);

const forbiddenPatterns = [
  { name: 'GitHub Actions', regex: /github\s*actions/i },
  { name: 'deploy.yml', regex: /deploy\.ya?ml/i },
  { name: 'GitHub Pages', regex: /github\s*pages/i },
  { name: 'gh-pages', regex: /gh-pages/i },
  { name: 'base /logbook/', regex: /base:\s*['"]\/logbook\/?['"]/i },
  { name: 'nested logbook path', regex: /\/logbook\//i }
];

console.log('\n=== FORBIDDEN PATTERN CHECKS ===');
let forbiddenFailed = false;
for (const p of forbiddenPatterns) {
  const match = content.match(p.regex);
  if (match) {
    console.error('FAIL: Found forbidden pattern:', p.name, '=>', match[0]);
    forbiddenFailed = true;
  } else {
    console.log('PASS: Zero matches for', p.name);
  }
}

const requiredPatterns = [
  { name: 'Vercel hosting in Stack', regex: /Hosting & deployment:.*Vercel/i },
  { name: 'Vercel auto deploy git push', regex: /deploy automatico a ogni `git push`/i },
  { name: 'Root path /', regex: /servito sulla radice `\/` del dominio/i },
  { name: 'Zero-config CI/CD', regex: /zero-config CI\/CD/i },
  { name: 'Vercel Analytics and Speed Insights', regex: /@vercel\/analytics.*@vercel\/speed-insights/i },
  { name: 'Vercel Section 5 Title', regex: /## 5\. Vincoli Firebase, hosting Vercel e sicurezza domini/i },
  { name: 'Vercel Environment Variables dashboard', regex: /dashboard di Vercel/i },
  { name: 'Vercel hosting platform official statement', regex: /ospitata ufficialmente sulla piattaforma \*\*Vercel\*\*/i },
  { name: 'Vite config root base: /', regex: /vite\.config\.ts.*base:\s*'\/'/i },
  { name: 'No subpaths allowed', regex: /vietato l'utilizzo di subpath o prefissi URL annidati/i },
  { name: 'Checklist Obligatoria header', regex: /CHECKLIST OBBLIGATORIA SICUREZZA E DOMINI/i },
  { name: 'Firebase Authorized domains step', regex: /Firebase Authentication \(Authorized domains\)/i },
  { name: 'Firebase Authorized domains path', regex: /Authentication.*Settings.*Authorized domains/i },
  { name: 'Firebase Authorized domains example', regex: /nome\.vercel\.app/i },
  { name: 'Firebase auth error prevention', regex: /auth\/unauthorized-domain/i },
  { name: 'Google Cloud Browser key referrers step', regex: /Google Cloud \(Browser key \/ referrers\)/i },
  { name: 'Wildcard asterisk syntax example 1', regex: /\*nome\.vercel\.app\/\*/i },
  { name: 'Wildcard asterisk syntax example 2', regex: /\*nome-app\.vercel\.app\/\*/i },
  { name: 'Google Cloud navigation path', regex: /APIs & Services.*Credentials.*Browser key/i },
  { name: '403 Forbidden prevention', regex: /403 Forbidden/i }
];

console.log('\n=== REQUIRED PATTERN CHECKS ===');
let requiredFailed = false;
for (const p of requiredPatterns) {
  const match = content.match(p.regex);
  if (!match) {
    console.error('FAIL: Missing required pattern:', p.name);
    requiredFailed = true;
  } else {
    console.log('PASS: Found', p.name);
  }
}

if (!forbiddenFailed && !requiredFailed) {
  console.log('\nALL ADVERSARIAL PATTERN CHECKS PASSED PERFECTLY!');
  process.exit(0);
} else {
  console.error('\nSOME ADVERSARIAL CHECKS FAILED!');
  process.exit(1);
}
