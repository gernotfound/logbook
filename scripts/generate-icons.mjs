import { readFile } from 'node:fs/promises';
import path from 'node:path';
import sharp from 'sharp';

const publicDir = path.resolve('public');
const masterPath = path.join(publicDir, 'favicon.svg');
const masterSvg = await readFile(masterPath, 'utf8');

function extract(pattern, label) {
  const match = masterSvg.match(pattern);
  if (!match) throw new Error(`Icon master is missing ${label}`);
  return match[0];
}

const defs = extract(/<defs>[\s\S]*?<\/defs>/, '<defs>');
const background = extract(/<g id="background">[\s\S]*?<\/g>/, '#background');
const frame = extract(/<g id="frame">[\s\S]*?<\/g>/, '#frame');
const monogram = extract(/<g id="monogram">[\s\S]*?<\/g>/, '#monogram');

async function writePng(filename, size, source = masterSvg) {
  await sharp(Buffer.from(source))
    .resize(size, size, { fit: 'fill' })
    .removeAlpha()
    .png({ compressionLevel: 9, adaptiveFiltering: true })
    .toFile(path.join(publicDir, filename));
}

// Standard/browser/iOS assets retain the approved artwork exactly.
await Promise.all([
  writePng('favicon.png', 64),
  writePng('apple-touch-icon.png', 180),
  writePng('icon-192.png', 192),
  writePng('icon-512.png', 512),
]);

// Adaptive Android/PWA masks can crop the perimeter. Keep the branded background
// full-bleed while scaling only the decorative frame and [LB] mark into the safe zone.
const maskableSvg = `<svg xmlns="http://www.w3.org/2000/svg" width="1024" height="1024" viewBox="0 0 1024 1024">${defs}${background}<g transform="translate(512 512) scale(0.62) translate(-512 -512)">${frame}${monogram}</g></svg>`;

await Promise.all([
  writePng('icon-maskable-192.png', 192, maskableSvg),
  writePng('icon-maskable-512.png', 512, maskableSvg),
]);

console.log('Generated LogBook icons from public/favicon.svg');
