import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const source = 'public/favicon.svg';
const targets = [
  ['public/favicon.png', 64],
  ['public/apple-touch-icon.png', 180],
  ['public/icon-192.png', 192],
  ['public/icon-512.png', 512],
];

async function readEmbeddedArtwork() {
  const svg = await readFile(source, 'utf8');
  const match = svg.match(/<image\b[^>]*\bhref=(['"])data:image\/(png|jpe?g|webp);base64,([\s\S]*?)\1/i);
  if (!match) {
    throw new Error(`${source} must contain one base64-embedded PNG, JPEG, or WebP artwork image.`);
  }

  const buffer = Buffer.from(match[3].replace(/\s+/g, ''), 'base64');
  if (buffer.length < 1024) {
    throw new Error(`${source} embedded artwork is unexpectedly small or invalid.`);
  }

  const metadata = await sharp(buffer).metadata();
  if (!metadata.width || !metadata.height || metadata.width !== metadata.height || metadata.width < 512) {
    throw new Error(`${source} embedded artwork must be square and at least 512x512.`);
  }

  return buffer;
}

async function validateGeneratedIcon(output, size) {
  const image = sharp(output);
  const [metadata, stats] = await Promise.all([image.metadata(), image.stats()]);

  if (metadata.width !== size || metadata.height !== size || metadata.format !== 'png') {
    throw new Error(`${output} was not generated as the expected ${size}x${size} PNG.`);
  }

  const visibleVariation = Math.max(...stats.channels.slice(0, 3).map(channel => channel.stdev));
  if (!Number.isFinite(visibleVariation) || visibleVariation < 5) {
    throw new Error(`${output} appears blank or visually degenerate.`);
  }
}

export async function generateIcons() {
  const artwork = await readEmbeddedArtwork();

  for (const [output, size] of targets) {
    await sharp(artwork)
      .resize(size, size, { fit: 'fill', kernel: sharp.kernel.lanczos3 })
      .png({ compressionLevel: 9 })
      .toFile(output);
    await validateGeneratedIcon(output, size);
  }

  console.log(`Generated and validated ${targets.length} icon assets from ${source}.`);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  await generateIcons();
}
