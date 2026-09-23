import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const source = 'public/favicon.svg';
const appBackground = '#070b18';
const pngTargets = [
  { output: 'public/favicon.png', size: 64, opaque: false },
  { output: 'public/apple-touch-icon.png', size: 180, opaque: true },
  { output: 'public/icon-192.png', size: 192, opaque: true },
  { output: 'public/icon-512.png', size: 512, opaque: true },
];
const faviconIcoOutput = 'public/favicon.ico';
const maskableOutput = 'public/icon-maskable-512.png';
const maskableSize = 512;
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

async function validateSource(svg) {
  const text = svg.toString('utf8');
  if (!/<svg\b/i.test(text)) throw new Error(`${source} is not valid SVG markup.`);
  if (/<image\b[^>]*\bhref=(['"])data:image\//i.test(text)) {
    throw new Error(`${source} must remain a true vector source without embedded raster artwork.`);
  }
  const metadata = await sharp(svg).metadata();
  if (metadata.format !== 'svg' || !metadata.width || !metadata.height || metadata.width !== metadata.height || metadata.width < 1024) {
    throw new Error(`${source} must be a square vector artwork at least 1024x1024.`);
  }
}

async function validateMaskableSafeZone(svg) {
  const { data, info } = await sharp(svg)
    .resize(maskableSize, maskableSize, { fit: 'fill', kernel: sharp.kernel.lanczos3 })
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
    throw new Error(`${source} does not expose a sufficiently large light LB mark for maskable safe-zone validation.`);
  }

  const center = maskableSize / 2;
  const safeRadius = maskableSize * 0.4;
  for (const [x, y] of [[minX, minY], [maxX, minY], [minX, maxY], [maxX, maxY]]) {
    if (Math.hypot(x + 0.5 - center, y + 0.5 - center) > safeRadius) {
      throw new Error(`${maskableOutput} would place the primary LB mark outside the standard maskable safe circle.`);
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

function createSocialBackground() {
  return Buffer.from(`
    <svg xmlns="http://www.w3.org/2000/svg" width="1200" height="630" viewBox="0 0 1200 630">
      <defs>
        <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stop-color="#07111f"/>
          <stop offset="0.55" stop-color="#070b18"/>
          <stop offset="1" stop-color="#09081c"/>
        </linearGradient>
        <radialGradient id="cyan" cx="15%" cy="20%" r="70%">
          <stop offset="0" stop-color="#00d7ff" stop-opacity="0.24"/>
          <stop offset="1" stop-color="#00d7ff" stop-opacity="0"/>
        </radialGradient>
        <radialGradient id="violet" cx="85%" cy="80%" r="65%">
          <stop offset="0" stop-color="#6e00ff" stop-opacity="0.20"/>
          <stop offset="1" stop-color="#6e00ff" stop-opacity="0"/>
        </radialGradient>
      </defs>
      <rect width="1200" height="630" fill="url(#bg)"/>
      <rect width="1200" height="630" fill="url(#cyan)"/>
      <rect width="1200" height="630" fill="url(#violet)"/>
    </svg>
  `);
}

export async function generateIcons() {
  const svg = await readFile(source);
  await validateSource(svg);

  for (const { output, size, opaque } of pngTargets) {
    let pipeline = sharp(svg).resize(size, size, { fit: 'fill', kernel: sharp.kernel.lanczos3 });
    if (opaque) pipeline = pipeline.flatten({ background: appBackground });
    await pipeline.png({ compressionLevel: 9 }).toFile(output);
    await validateRaster(output, size, size, 'png', { opaque });
  }

  const icoImages = await Promise.all([16, 32].map(async size => ({
    size,
    buffer: await sharp(svg).resize(size, size, { fit: 'fill', kernel: sharp.kernel.lanczos3 }).png().toBuffer(),
  })));
  await writeFile(faviconIcoOutput, createIco(icoImages));
  await validateIco(faviconIcoOutput);

  await validateMaskableSafeZone(svg);
  await sharp(svg)
    .resize(maskableSize, maskableSize, { fit: 'fill', kernel: sharp.kernel.lanczos3 })
    .flatten({ background: appBackground })
    .png({ compressionLevel: 9 })
    .toFile(maskableOutput);
  await validateRaster(maskableOutput, maskableSize, maskableSize, 'png', { opaque: true });

  const socialIcon = await sharp(svg).resize(430, 430, { fit: 'contain' }).png().toBuffer();
  await sharp(createSocialBackground())
    .composite([{ input: socialIcon, gravity: 'centre' }])
    .jpeg({ quality: 92, chromaSubsampling: '4:4:4' })
    .toFile(socialOutput);
  await validateRaster(socialOutput, 1200, 630, 'jpeg', { opaque: true });

  console.log(`Generated and validated ${pngTargets.length + 3} branded assets from ${source}.`);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) await generateIcons();
