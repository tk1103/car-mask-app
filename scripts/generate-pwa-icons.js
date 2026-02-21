#!/usr/bin/env node
/**
 * PWA用アイコンを生成（黒背景・白「Carkus」）。public/icon-192.png と icon-512.png を出力。
 * 実行: node scripts/generate-pwa-icons.js
 */

const sharp = require('sharp');
const fs = require('fs');
const path = require('path');

const outDir = path.join(__dirname, '..', 'public');

function makeSvg(size) {
  const fontSize = Math.round((size / 192) * 28);
  const y = Math.round(size * 0.614);
  const rx = size >= 512 ? 64 : 24;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">
  <rect width="${size}" height="${size}" fill="#000000" rx="${rx}"/>
  <text x="${size / 2}" y="${y}" text-anchor="middle" font-family="system-ui, -apple-system, sans-serif" font-size="${fontSize}" font-weight="300" fill="#ffffff" letter-spacing="0.2em">Carkus</text>
</svg>`;
}

async function main() {
  for (const size of [192, 512]) {
    const svg = makeSvg(size);
    const outPath = path.join(outDir, `icon-${size}.png`);
    await sharp(Buffer.from(svg)).png().toFile(outPath);
    console.log('Written:', outPath);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
