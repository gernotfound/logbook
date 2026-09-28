import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const source = 'assets/pwa-icon-source.webp';
const appBackground = '#000000';
const pngTargets = [
  { output: 'public/favicon.png', size: 64, opaque: true },
  { output: 'public/apple-touch-icon.png', size: 180, opaque: true },
  { output: 'public/icon-192.png', size: 192, opaque: true },
  { output: 'public/icon-512.png', size: 512, opaque: true },
];
const faviconIcoOutput = 'public/favicon.ico';
const maskableOutput = 'public/icon-maskable-512.png';
const maskableSize = 512;
const maskableArtworkScale = 0.72;
const socialOutput = 'public/social-share.jpg';

async function validateRaster(output, width, height, format, { opaque = false } = {}) {
  const image = sharp(output);
  const [metadata, stats] = await Promise.all([image.metadata(), image.stats()]);
  if (metadata.width !== width || metadata.height !== height || metadata.format !== format) {
    throw new Error(`${output} was not generated as the expected ${width}x${height} ${format}.`);
  }
  const visibleVariation = Math.max(...stats.channels.slice(0, 3).map(channel => channel.stdev));
  if (!Number.isFinite(visibleVariation) || visibleVariation < 5) {
    throw new Error(`${output} appears blank or visually degenerate.`);
  }
  if (opaque && !stats.isOpaque) throw new Error(`${output} must be fully opaque for launcher compatibility.`);
}

async function validateSource(image) {
  const [metadata, stats] = await Promise.all([sharp(image).metadata(), sharp(image).stats()]);
  if (!['jpeg', 'png', 'webp'].includes(metadata.format ?? '')) {
    throw new Error(`${source} must be a supported raster image (JPEG, PNG or WebP).`);
  }
  if (!metadata.width || !metadata.height || metadata.width !== metadata.height || metadata.width < 1024) {
    throw new Error(`${source} must be square raster artwork at least 1024x1024.`);
  }
  const visibleVariation = Math.max(...stats.channels.slice(0, 3).map(channel => channel.stdev));
  if (!Number.isFinite(visibleVariation) || visibleVariation < 5) {
    throw new Error(`${source} appears blank or visually degenerate.`);
  }
}

async function createMaskableIcon(image) {
  const artworkSize = Math.round(maskableSize * maskableArtworkScale);
  const artwork = await sharp(image)
    .resize(artworkSize, artworkSize, { fit: 'fill', kernel: sharp.kernel.lanczos3 })
    .png({ compressionLevel: 9 })
    .toBuffer();

  return sharp({
    create: {
      width: maskableSize,
      height: maskableSize,
      channels: 4,
      background: appBackground,
    },
  })
    .composite([{ input: artwork, gravity: 'centre' }])
    .png({ compressionLevel: 9 })
    .toBuffer();
}

async function validateMaskableSafeZone(image) {
  const { data, info } = await sharp(image)
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  let minX = info.width;
  let minY = info.height;
  let maxX = -1;
  let maxY = -1;
  let markedPixels = 0;

  for (let y = 0; y < info.height; y += 1) {
    for (let x = 0; x < info.width; x += 1) {
      const offset = (y * info.width + x) * info.channels;
      const whiteness = Math.min(data[offset], data[offset + 1], data[offset + 2]);
      const alpha = data[offset + 3];
      if (whiteness < 220 || alpha < 180) continue;
      markedPixels += 1;
      minX = Math.min(minX, x);
      minY = Math.min(minY, y);
      maxX = Math.max(maxX, x);
      maxY = Math.max(maxY, y);
    }
  }

  if (markedPixels < 1000 || maxX < minX || maxY < minY) {
    throw new Error(`${source} does not expose sufficiently large light artwork for maskable safe-zone validation.`);
  }

  const center = maskableSize / 2;
  const safeRadius = maskableSize * 0.4;
  for (const [x, y] of [[minX, minY], [maxX, minY], [minX, maxY], [maxX, maxY]]) {
    if (Math.hypot(x + 0.5 - center, y + 0.5 - center) > safeRadius) {
      throw new Error(`${maskableOutput} would place the primary artwork outside the standard maskable safe circle.`);
    }
  }
}

function createIco(images) {
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(images.length, 4);
  const entries = Buffer.alloc(images.length * 16);
  let offset = header.length + entries.length;

  images.forEach(({ size, buffer }, index) => {
    const base = index * 16;
    entries.writeUInt8(size === 256 ? 0 : size, base);
    entries.writeUInt8(size === 256 ? 0 : size, base + 1);
    entries.writeUInt8(0, base + 2);
    entries.writeUInt8(0, base + 3);
    entries.writeUInt16LE(1, base + 4);
    entries.writeUInt16LE(32, base + 6);
    entries.writeUInt32LE(buffer.length, base + 8);
    entries.writeUInt32LE(offset, base + 12);
    offset += buffer.length;
  });
  return Buffer.concat([header, entries, ...images.map(image => image.buffer)]);
}

async function validateIco(output) {
  const ico = await readFile(output);
  if (ico.length < 128 || ico.readUInt16LE(0) !== 0 || ico.readUInt16LE(2) !== 1 || ico.readUInt16LE(4) !== 2) {
    throw new Error(`${output} is not a valid two-size browser ICO.`);
  }
  const sizes = [ico.readUInt8(6), ico.readUInt8(22)];
  if (sizes[0] !== 16 || sizes[1] !== 32) throw new Error(`${output} must contain 16x16 and 32x32 entries.`);
}

async function createSocialBackground() {
  return sharp({
    create: {
      width: 1200,
      height: 630,
      channels: 3,
      background: appBackground,
    },
  })
    .jpeg({ quality: 100, chromaSubsampling: '4:4:4' })
    .toBuffer();
}

export async function generateIcons() {
  const image = await readFile(source);
  await validateSource(image);

  for (const { output, size, opaque } of pngTargets) {
    let pipeline = sharp(image).resize(size, size, { fit: 'fill', kernel: sharp.kernel.lanczos3 });
    if (opaque) pipeline = pipeline.flatten({ background: appBackground });
    await pipeline.png({ compressionLevel: 9 }).toFile(output);
    await validateRaster(output, size, size, 'png', { opaque });
  }

  const icoImages = await Promise.all([16, 32].map(async size => ({
    size,
    buffer: await sharp(image).resize(size, size, { fit: 'fill', kernel: sharp.kernel.lanczos3 }).png().toBuffer(),
  })));
  await writeFile(faviconIcoOutput, createIco(icoImages));
  await validateIco(faviconIcoOutput);

  const maskableIcon = await createMaskableIcon(image);
  await validateMaskableSafeZone(maskableIcon);
  await writeFile(maskableOutput, maskableIcon);
  await validateRaster(maskableOutput, maskableSize, maskableSize, 'png', { opaque: true });

  const socialIcon = await sharp(image).resize(430, 430, { fit: 'contain' }).png().toBuffer();
  await sharp(await createSocialBackground())
    .composite([{ input: socialIcon, gravity: 'centre' }])
    .jpeg({ quality: 92, chromaSubsampling: '4:4:4' })
    .toFile(socialOutput);
  await validateRaster(socialOutput, 1200, 630, 'jpeg', { opaque: true });

  console.log(`Generated and validated ${pngTargets.length + 3} branded assets from ${source}.`);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) await generateIcons();
