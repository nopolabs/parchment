#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import sharp from 'sharp';

const WIDTH = 2700;
const HEIGHT = 1050;

// Printful's 11 oz mug template is 9" x 3.5" at 300 DPI.
// The template marks two face centers for graphics that appear with the handle
// left or handle right; keep the design compact around those centers instead of
// treating the whole wrap as a certificate-shaped canvas.
const FACE_CENTERS = [585, 2115];
const DEFAULT_SEAL = '/Users/danrevel/lab/projects/clodsite-sites/bbpp/assets/bbpp-seal.png';

const args = parseArgs(process.argv.slice(2));
const name = args.name || 'Dan Revel';
const achievement = args.achievement ||
  'In recognition of extraordinary contributions to the art of peaceful coexistence';
const date = args.date || new Date().toLocaleDateString('en-US', {
  year: 'numeric',
  month: 'long',
  day: 'numeric',
});
const serial = args.serial || 'BBPP-0001';
const output = path.resolve(args.output || 'artifacts/bbpp-mug-sample.png');
const sealPath = path.resolve(args.seal || DEFAULT_SEAL);

const fontsDir = path.resolve('assets/fonts');
const titleFont = fontFace('Cormorant Garamond', path.join(fontsDir, 'CormorantGaramond-SemiBold.ttf'), 600);
const bodyFont = fontFace('Source Sans Pro', path.join(fontsDir, 'SourceSansPro-Regular.ttf'), 400);
const seal = dataUrl(sealPath, 'image/png');

const svg = buildSvg({ name, achievement, date, serial, seal, titleFont, bodyFont });

await fs.promises.mkdir(path.dirname(output), { recursive: true });
await sharp(Buffer.from(svg)).png().toFile(output);

console.log('Wrote ' + output);

function buildSvg({ name, achievement, date, serial, seal, titleFont, bodyFont }) {
  const escapedName = escapeXml(name);
  const achievementLines = wrapText(achievement, 46).map(escapeXml);
  const escapedDate = escapeXml(date);
  const escapedSerial = escapeXml(serial);

  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${WIDTH}" height="${HEIGHT}" viewBox="0 0 ${WIDTH} ${HEIGHT}">
  <defs>
    <style>
      ${titleFont}
      ${bodyFont}
      .title { font-family: "Cormorant Garamond"; font-weight: 600; fill: #0d2844; }
      .body { font-family: "Source Sans Pro"; font-weight: 400; fill: #2d4a6a; }
      .accent { fill: #c9a227; }
      .border { stroke: #c9a227; stroke-width: 4; fill: none; }
      .rule { stroke: #c9a227; stroke-width: 5; stroke-linecap: round; }
    </style>
    <filter id="soft-shadow" x="-20%" y="-20%" width="140%" height="140%">
      <feDropShadow dx="0" dy="8" stdDeviation="10" flood-color="#0d2844" flood-opacity="0.14"/>
    </filter>
  </defs>

  <rect x="0" y="0" width="${WIDTH}" height="${HEIGHT}" fill="#ffffff"/>
${buildSealFace({ centerX: FACE_CENTERS[0], seal })}
${buildTextFace({ centerX: FACE_CENTERS[1], escapedName, achievementLines, escapedDate, escapedSerial })}
</svg>`;
}

function buildSealFace({ centerX, seal }) {
  const x = centerX - 300;
  return `  <g transform="translate(${x} 155)">
    <image href="${seal}" x="-20" y="50" width="640" height="640" preserveAspectRatio="xMidYMid meet" filter="url(#soft-shadow)"/>
  </g>`;
}

function buildTextFace({ centerX, escapedName, achievementLines, escapedDate, escapedSerial }) {
  const x = centerX - 330;
  const subtitle = buildAchievementBlock(achievementLines);

  return `  <g transform="translate(${x} 155)">
    <rect class="border" x="0" y="10" width="660" height="710" rx="18"/>
    <text class="title" x="330" y="135" text-anchor="middle" font-size="64">The Big Beautiful</text>
    <text class="title" x="330" y="210" text-anchor="middle" font-size="82">Peace Prize</text>
    <line class="rule" x1="160" y1="260" x2="500" y2="260"/>
    <text class="body" x="330" y="330" text-anchor="middle" font-size="28" font-style="italic">Presented to</text>
    <text class="title" x="330" y="420" text-anchor="middle" font-size="64">${escapedName}</text>
    <text class="body accent" x="330" y="505" text-anchor="middle" font-size="26" letter-spacing="4">PEACE PRIZE LAUREATE</text>
${subtitle}
    <text class="body" x="65" y="685" text-anchor="start" font-size="19">${escapedDate}</text>
    <text class="body" x="595" y="685" text-anchor="end" font-size="19">${escapedSerial}</text>
  </g>`;
}

function buildAchievementBlock(lines) {
  const top = 570;
  const bottom = 650;
  const available = bottom - top;
  const count = Math.max(1, lines.length);
  const fontSize = Math.max(14, Math.min(23, Math.floor(available / count * 0.72)));
  const lineHeight = Math.floor(fontSize * 1.35);
  const blockHeight = lineHeight * (count - 1);
  const firstBaseline = top + Math.floor((available - blockHeight) / 2);

  return lines
    .map((line, index) => {
      const y = firstBaseline + index * lineHeight;
      return `    <text class="body" x="330" y="${y}" text-anchor="middle" font-size="${fontSize}" font-style="italic">${line}</text>`;
    })
    .join('\n');
}

function parseArgs(argv) {
  const parsed = {};
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (!arg.startsWith('--')) continue;
    const key = arg.slice(2);
    const value = argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[++i] : 'true';
    parsed[key] = value;
  }
  return parsed;
}

function dataUrl(filePath, contentType) {
  const data = fs.readFileSync(filePath);
  return `data:${contentType};base64,${data.toString('base64')}`;
}

function fontFace(name, filePath, weight) {
  const data = fs.readFileSync(filePath).toString('base64');
  return `@font-face { font-family: "${name}"; font-weight: ${weight}; src: url(data:font/ttf;base64,${data}) format("truetype"); }`;
}

function escapeXml(value) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&apos;');
}

function wrapText(text, maxChars) {
  const words = String(text).trim().split(/\s+/);
  const lines = [];
  let current = '';

  for (const word of words) {
    const next = current ? current + ' ' + word : word;
    if (next.length > maxChars && current) {
      lines.push(current);
      current = word;
    } else {
      current = next;
    }
  }
  if (current) lines.push(current);
  return lines;
}
