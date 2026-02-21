#!/usr/bin/env node
/**
 * OpenCV.js を public/opencv.js にダウンロードします。
 * カメラのリアルタイム矩形検出で使用します。初回のみ実行してください。
 *
 * 使い方: node scripts/download-opencv.js
 */

const https = require('https');
const fs = require('fs');
const path = require('path');

const URL = 'https://unpkg.com/@techstark/opencv-js@4.11.0-release.1/dist/opencv.js';
const OUT = path.join(__dirname, '..', 'public', 'opencv.js');

const dir = path.dirname(OUT);
if (!fs.existsSync(dir)) {
  fs.mkdirSync(dir, { recursive: true });
}

console.log('Downloading OpenCV.js (this may take a minute)...');
const file = fs.createWriteStream(OUT);

https
  .get(URL, (res) => {
    if (res.statusCode === 302 || res.statusCode === 301) {
      const redirect = res.headers.location;
      if (redirect) {
        https.get(redirect, (res2) => res2.pipe(file));
        return;
      }
    }
    if (res.statusCode !== 200) {
      console.error('Download failed:', res.statusCode, res.statusMessage);
      file.close();
      fs.unlink(OUT, () => {});
      process.exit(1);
    }
    res.pipe(file);
  })
  .on('error', (err) => {
    console.error('Error:', err.message);
    file.close();
    fs.unlink(OUT, () => {});
    process.exit(1);
  });

file.on('finish', () => {
  file.close();
  console.log('Saved to public/opencv.js');
});
