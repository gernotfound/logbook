import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const source = 'public/favicon.svg';
const targets = [
  ['public/favicon.png', 64],
  ['public/apple-touch-icon.png', 180],
  ['public/icon-192.png', 192],
  ['public/icon-512.png', 512],
];

export async function generateIcons() {
  for (const [output, size] of targets) {
    await sharp(source, { density: 384 })
      .resize(size, size, { fit: 'fill', kernel: sharp.kernel.lanczos3 })
      .png({ compressionLevel: 9 })
      .toFile(output);
  }

  console.log(`Generated ${targets.length} icon assets from ${source}.`);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  await generateIcons();
}
