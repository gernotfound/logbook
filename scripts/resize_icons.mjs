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
const maskableSafeRadius = maskableSize * 0.4;

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

function findLargeWhiteComponents(data, width, height, channels) {
  const pixelCount = width * height;
  const candidate = new Uint8Array(pixelCount);
  const visited = new Uint8Array(pixelCount);
  const components = [];

  for (let pixel = 0; pixel < pixelCount; pixel += 1) {
    const offset = pixel * channels;
    const whiteness = Math.min(data[offset], data[offset + 1], data[offset + 2]);
    if (whiteness > 180) candidate[pixel] = 1;
  }

  for (let start = 0; start < pixelCount; start += 1) {
    if (!candidate[start] || visited[start]) continue;

    const stack = [start];
    visited[start] = 1;
    let size = 0;
    let minX = width;
    let minY = height;
    let maxX = 0;
    let maxY = 0;

    while (stack.length) {
      const pixel = stack.pop();
      size += 1;
      const x = pixel % width;
      const y = Math.floor(pixel / width);
      minX = Math.min(minX, x);
      minY = Math.min(minY, y);
      maxX = Math.max(maxX, x);
      maxY = Math.max(maxY, y);

      if (x > 0) {
        const next = pixel - 1;
        if (candidate[next] && !visited[next]) {
          visited[next] = 1;
          stack.push(next);
        }
      }
      if (x + 1 < width) {
        const next = pixel + 1;
        if (candidate[next] && !visited[next]) {
          visited[next] = 1;
          stack.push(next);
        }
      }
      if (y > 0) {
        const next = pixel - width;
        if (candidate[next] && !visited[next]) {
          visited[next] = 1;
          stack.push(next);
        }
      }
      if (y + 1 < height) {
        const next = pixel + width;
        if (candidate[next] && !visited[next]) {
          visited[next] = 1;
          stack.push(next);
        }
      }
    }

    if (size >= 1000) components.push({ size, minX, minY, maxX, maxY });
  }

  components.sort((a, b) => b.size - a.size);
  if (components.length !== 4) {
    throw new Error(`${source} must contain the four large white [LB] glyph components expected by the maskable derivative; found ${components.length}.`);
  }

  return components;
}

function createMaskableMark(data, width, height, channels, components) {
  const mark = Buffer.alloc(width * height * 4);
  const expandedBoxes = components.map(component => ({
    minX: Math.max(0, component.minX - 2),
    minY: Math.max(0, component.minY - 2),
    maxX: Math.min(width - 1, component.maxX + 2),
    maxY: Math.min(height - 1, component.maxY + 2),
  }));

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const outputOffset = (y * width + x) * 4;
      mark[outputOffset] = 255;
      mark[outputOffset + 1] = 255;
      mark[outputOffset + 2] = 255;

      if (!expandedBoxes.some(box => x >= box.minX && x <= box.maxX && y >= box.minY && y <= box.maxY)) {
        continue;
      }

      const sourceOffset = (y * width + x) * channels;
      const whiteness = Math.min(data[sourceOffset], data[sourceOffset + 1], data[sourceOffset + 2]);
      mark[outputOffset + 3] = Math.max(0, Math.min(255, Math.round(((whiteness - 160) * 255) / 80)));
    }
  }

  return mark;
}

function validateMaskableSafeZone(components, sourceSize) {
  const scale = maskableArtworkSize / sourceSize;
  const offset = (maskableSize - maskableArtworkSize) / 2;
  const center = maskableSize / 2;

  for (const component of components) {
    for (const [x, y] of [
      [component.minX, component.minY],
      [component.maxX, component.minY],
      [component.minX, component.maxY],
      [component.maxX, component.maxY],
    ]) {
      const mappedX = (x + 0.5) * scale + offset;
      const mappedY = (y + 0.5) * scale + offset;
      const distance = Math.hypot(mappedX - center, mappedY - center);
      if (distance > maskableSafeRadius) {
        throw new Error(`${maskableOutput} would place approved [LB] content outside the standard maskable safe circle.`);
      }
    }
  }
}

function createMaskableBackground() {
  return Buffer.from(`
    <svg xmlns="http://www.w3.org/2000/svg" width="${maskableSize}" height="${maskableSize}" viewBox="0 0 ${maskableSize} ${maskableSize}">
      <defs>
        <radialGradient id="cyan" cx="0%" cy="50%" r="78%">
          <stop offset="0%" stop-color="#00e5ff" stop-opacity="0.30"/>
          <stop offset="100%" stop-color="#00e5ff" stop-opacity="0"/>
        </radialGradient>
        <radialGradient id="magenta" cx="100%" cy="53%" r="78%">
          <stop offset="0%" stop-color="#cc00ff" stop-opacity="0.30"/>
          <stop offset="100%" stop-color="#cc00ff" stop-opacity="0"/>
        </radialGradient>
        <radialGradient id="blue" cx="51%" cy="0%" r="84%">
          <stop offset="0%" stop-color="#2850be" stop-opacity="0.18"/>
          <stop offset="100%" stop-color="#2850be" stop-opacity="0"/>
        </radialGradient>
        <linearGradient id="sheen" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stop-color="#87bfff" stop-opacity="0.12"/>
          <stop offset="100%" stop-color="#87bfff" stop-opacity="0"/>
        </linearGradient>
      </defs>
      <rect width="512" height="512" fill="#010207"/>
      <rect width="512" height="512" fill="url(#cyan)"/>
      <rect width="512" height="512" fill="url(#magenta)"/>
      <rect width="512" height="512" fill="url(#blue)"/>
      <path d="M0 0H360L90 280L0 325Z" fill="url(#sheen)"/>
    </svg>
  `);
}

async function generateMaskableIcon(artwork) {
  // Adaptive launchers may crop any outer shape. Reuse the approved white [LB]
  // geometry, but put it on a full-bleed LogBook background so no nested rounded
  // square remains visible after circle/squircle masking.
  const { data, info } = await sharp(artwork)
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });

  if (info.width !== info.height || info.width < 512 || info.channels < 3) {
    throw new Error(`${source} cannot produce the maskable derivative from its embedded artwork.`);
  }

  const components = findLargeWhiteComponents(data, info.width, info.height, info.channels);
  validateMaskableSafeZone(components, info.width);
  const mark = createMaskableMark(data, info.width, info.height, info.channels, components);
  const insetMark = await sharp(mark, {
    raw: { width: info.width, height: info.height, channels: 4 },
  })
    .resize(maskableArtworkSize, maskableArtworkSize, { fit: 'fill', kernel: sharp.kernel.lanczos3 })
    .png()
    .toBuffer();

  await sharp(createMaskableBackground())
    .composite([{ input: insetMark, gravity: 'centre' }])
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
