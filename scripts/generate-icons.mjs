import { chromium } from '@playwright/test';
import { readFile, writeFile, mkdir, mkdtemp, rm } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { execFileSync } from 'node:child_process';

const browser = await chromium.launch({ channel: 'chrome', headless: true });
const temporary = await mkdtemp(join(tmpdir(), 'muncher-icons-'));
try {
  const page = await browser.newPage({ viewport: { width: 1024, height: 1024 }, deviceScaleFactor: 1 });
  const svg = await readFile('assets/icon.svg', 'utf8');
  await page.setContent(`<style>body{margin:0;background:transparent}svg{width:100vw;height:100vh;display:block}</style>${svg}`);
  await page.screenshot({ path: 'assets/icon.png', omitBackground: true });
  await page.setViewportSize({ width: 256, height: 256 });
  const png = await page.screenshot({ omitBackground: true });
  const header = Buffer.alloc(22);
  header.writeUInt16LE(1, 2); header.writeUInt16LE(1, 4);
  header.writeUInt16LE(1, 10); header.writeUInt16LE(32, 12);
  header.writeUInt32LE(png.length, 14); header.writeUInt32LE(22, 18);
  await writeFile('assets/icon.ico', Buffer.concat([header, png]));
  if (process.platform === 'darwin') {
    const iconset = join(temporary, 'icon.iconset');
    await mkdir(iconset);
    for (const size of [16, 32, 128, 256, 512]) {
      for (const retina of [false, true]) {
        const pixels = size * (retina ? 2 : 1);
        execFileSync('sips', ['-z', String(pixels), String(pixels), resolve('assets/icon.png'), '--out', join(iconset, `icon_${size}x${size}${retina ? '@2x' : ''}.png`)], { stdio: 'ignore' });
      }
    }
    execFileSync('iconutil', ['-c', 'icns', iconset, '-o', resolve('assets/icon.icns')]);
  }
  console.log('Generated application icons.');
} finally { await browser.close(); await rm(temporary, { recursive: true, force: true }); }
