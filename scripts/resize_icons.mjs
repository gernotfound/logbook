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
const maskableOutput = 'public/icon-maskable-512.png';
const maskableSize = 512;
const maskableArtworkSize = Math.round(maskableSize * 0.88);

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

async function generateMaskableIcon(artwork) {
  // Keep the approved artwork unchanged for normal/iOS icons. Only the maskable
  // derivative is inset so the [LB] mark stays inside the standard 80% safe zone.
  const insetArtwork = await sharp(artwork)
    .resize(maskableArtworkSize, maskableArtworkSize, { fit: 'fill', kernel: sharp.kernel.lanczos3 })
    .png()
    .toBuffer();

  await sharp({
    create: {
      width: maskableSize,
      height: maskableSize,
      channels: 4,
      background: { r: 1, g: 1, b: 4, alpha: 1 },
    },
  })
    .composite([{ input: insetArtwork, gravity: 'centre' }])
    .png({ compressionLevel: 9 })
    .toFile(maskableOutput);

  await validateGeneratedIcon(maskableOutput, maskableSize);
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

  await generateMaskableIcon(artwork);

  console.log(`Generated and validated ${targets.length + 1} icon assets from ${source}.`);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  await generateIcons();
}
