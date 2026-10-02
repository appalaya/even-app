// Renders the store graphics in this folder (docs/store-listing.md, "Graphics"). Not part of the app or CI.
//
//   node docs/store/render.mjs feature [--subtitle "Pay whoever. End even."]
//       feature-graphic.html -> feature-graphic.png, 1024 x 500, 24-bit PNG with no alpha (Play's rule)
//   node docs/store/render.mjs icon
//       assets/icon.png -> play-icon-512.png, 512 x 512, 32-bit PNG with alpha (Play's rule), pixels as sips scales them
//   node docs/store/render.mjs caption --shot <capture> --caption "<line>" [--size ios|play] [--font system|inter] --out <png>
//       screenshot-caption.html -> a captioned screenshot, 1320 x 2868 (ios) or 1080 x 1920 (play), no alpha
//   node docs/store/render.mjs flatten in.png out.png
//       drops the alpha channel of a fully opaque capture (Android's screencap writes RGBA); pixels unchanged
//
// Needs Google Chrome in /Applications and Playwright, from node_modules or the npx cache (`npx playwright --version`
// puts it there). Nothing here goes to the network: the pages load only files from this repository.
import { execFileSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync, writeFileSync, mkdtempSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { crc32, deflateSync, inflateSync } from 'node:zlib';

const here = dirname(fileURLToPath(import.meta.url));
const repo = resolve(here, '../..');

async function loadPlaywright() {
  try {
    return await import('playwright');
  } catch {
    const npx = join(homedir(), '.npm/_npx');
    for (const dir of existsSync(npx) ? readdirSync(npx) : []) {
      const entry = join(npx, dir, 'node_modules/playwright/index.mjs');
      if (existsSync(entry)) return await import(pathToFileURL(entry).href);
    }
    throw new Error('Playwright not found: run `npx playwright --version` once, or npm install it somewhere above.');
  }
}

// ----- PNG channels: 8-bit, non-interlaced RGB or RGBA in; RGB or RGBA out; pixel values copied exactly -----

function readPng(path) {
  const buf = readFileSync(path);
  const chunks = [];
  for (let off = 8; off < buf.length; ) {
    const len = buf.readUInt32BE(off);
    chunks.push({ type: buf.toString('latin1', off + 4, off + 8), data: buf.subarray(off + 8, off + 8 + len) });
    off += 12 + len;
  }
  const ihdr = chunks.find((c) => c.type === 'IHDR').data;
  const [width, height, depth, colorType, interlace] = [
    ihdr.readUInt32BE(0),
    ihdr.readUInt32BE(4),
    ihdr[8],
    ihdr[9],
    ihdr[12],
  ];
  if (depth !== 8 || interlace !== 0 || (colorType !== 2 && colorType !== 6)) {
    throw new Error(`${path}: unsupported PNG (depth ${depth}, colour type ${colorType}, interlace ${interlace})`);
  }
  const bpp = colorType === 6 ? 4 : 3;
  const stride = width * bpp;
  const raw = inflateSync(Buffer.concat(chunks.filter((c) => c.type === 'IDAT').map((c) => c.data)));
  const px = Buffer.alloc(height * stride);
  for (let y = 0; y < height; y++) {
    const filter = raw[y * (stride + 1)];
    const line = raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1));
    const out = px.subarray(y * stride, (y + 1) * stride);
    const prev = y > 0 ? px.subarray((y - 1) * stride, y * stride) : null;
    for (let x = 0; x < stride; x++) {
      const a = x >= bpp ? out[x - bpp] : 0;
      const b = prev ? prev[x] : 0;
      const c = prev && x >= bpp ? prev[x - bpp] : 0;
      let v = line[x];
      if (filter === 1) v += a;
      else if (filter === 2) v += b;
      else if (filter === 3) v += (a + b) >> 1;
      else if (filter === 4) {
        const p = a + b - c;
        const [pa, pb, pc] = [Math.abs(p - a), Math.abs(p - b), Math.abs(p - c)];
        v += pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
      } else if (filter !== 0) throw new Error(`${path}: bad filter ${filter}`);
      out[x] = v & 0xff;
    }
  }
  const colour = chunks.filter((c) => ['iCCP', 'sRGB', 'gAMA', 'cHRM', 'pHYs'].includes(c.type));
  return { width, height, bpp, px, ihdr, colour };
}

function writePng(path, { width, height, bpp, px, ihdr, colour }, outBpp) {
  const outStride = width * outBpp;
  const raw = Buffer.alloc(height * (outStride + 1));
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * bpp;
      const o = y * (outStride + 1) + 1 + x * outBpp;
      if (bpp === 4 && outBpp === 3 && px[i + 3] !== 255) throw new Error(`${path}: pixel ${x},${y} is not opaque`);
      px.copy(raw, o, i, i + 3);
      if (outBpp === 4) raw[o + 3] = bpp === 4 ? px[i + 3] : 255;
    }
  }
  const chunk = (type, data) => {
    const body = Buffer.concat([Buffer.from(type, 'latin1'), data]);
    const len = Buffer.alloc(4);
    const crc = Buffer.alloc(4);
    len.writeUInt32BE(data.length);
    crc.writeUInt32BE(crc32(body) >>> 0);
    return Buffer.concat([len, body, crc]);
  };
  const head = Buffer.from(ihdr);
  head[9] = outBpp === 4 ? 6 : 2;
  writeFileSync(
    path,
    Buffer.concat([
      Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
      chunk('IHDR', head),
      ...colour.map((c) => chunk(c.type, c.data)),
      chunk('IDAT', deflateSync(raw, { level: 9 })),
      chunk('IEND', Buffer.alloc(0)),
    ]),
  );
}

// ----- Rendering -----

async function renderPage(html, query, width, height, out) {
  const { chromium } = await loadPlaywright();
  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  try {
    const page = await browser.newPage({ viewport: { width, height }, deviceScaleFactor: 1 });
    await page.goto(`${pathToFileURL(join(here, html)).href}?${new URLSearchParams(query)}`);
    await page.evaluate(async () => {
      await document.fonts.ready;
      await Promise.all([...document.images].map((img) => (img.complete ? null : img.decode())));
    });
    const tmp = join(mkdtempSync(join(tmpdir(), 'even-store-')), 'shot.png');
    await page.screenshot({ path: tmp, type: 'png' });
    writePng(out, readPng(tmp), 3);
  } finally {
    await browser.close();
  }
  console.log(`${relative(process.cwd(), out)}: ${width} x ${height}, RGB, no alpha`);
}

function arg(name, fallback) {
  const i = process.argv.indexOf(`--${name}`);
  return i > 0 ? process.argv[i + 1] : fallback;
}

const command = process.argv[2];
if (command === 'feature') {
  const subtitle = arg('subtitle');
  await renderPage('feature-graphic.html', subtitle ? { subtitle } : {}, 1024, 500, join(here, 'feature-graphic.png'));
} else if (command === 'icon') {
  const tmp = join(mkdtempSync(join(tmpdir(), 'even-store-')), 'icon-512.png');
  execFileSync('sips', ['-z', '512', '512', join(repo, 'assets/icon.png'), '--out', tmp], { stdio: 'ignore' });
  writePng(join(here, 'play-icon-512.png'), readPng(tmp), 4);
  console.log('docs/store/play-icon-512.png: 512 x 512, RGBA');
} else if (command === 'caption') {
  const [w, h] = arg('size', 'ios') === 'play' ? [1080, 1920] : [1320, 2868];
  const shot = arg('shot');
  const out = arg('out');
  if (!shot || !out) throw new Error('caption needs --shot and --out');
  const query = {
    shot: relative(here, resolve(shot)),
    caption: arg('caption', ''),
    w: String(w),
    h: String(h),
    font: arg('font', 'system'),
  };
  await renderPage('screenshot-caption.html', query, w, h, resolve(out));
} else if (command === 'flatten') {
  const [input, output] = process.argv.slice(3);
  if (!input || !output) throw new Error('flatten needs an input and an output path');
  writePng(resolve(output), readPng(resolve(input)), 3);
  console.log(`${output}: RGB, no alpha`);
} else {
  console.error('usage: node docs/store/render.mjs feature|icon|caption|flatten (see the top of this file)');
  process.exit(2);
}
