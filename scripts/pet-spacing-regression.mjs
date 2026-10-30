import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { chromium, expect } from '@playwright/test';

const appUrl = pathToFileURL(resolve('dist/index.html')).href;
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const sizes = [
  { width: 150, height: 194 },
  { width: 165, height: 206 },
  { width: 210, height: 242 },
  { width: 300, height: 315 },
];
const bodySelectors = {
  munch: '.munch-character',
  pixel: '.pixel-character',
  blade: '.tank-character',
  void: '.void-system',
  paper: '.paper-machine',
};
const records = [];
const failures = [];
await mkdir(resolve('test-results'), { recursive: true });

async function createPetPage(viewport, theme, grown) {
  const page = await browser.newPage({ viewport, deviceScaleFactor: 2 });
  await page.addInitScript(({ theme, grown, size }) => {
    const state = {
      preferences: { theme, deletionMode: 'trash', petVisible: true, reduceMotion: true, petSize: size },
      stats: grown ? { files: 1_000_000_000, bytes: 1024 ** 4, meals: 100 } : { files: 0, bytes: 0, meals: 0 },
    };
    const rejectFileOperation = async () => { throw new Error('Spacing tests never operate on files.'); };
    window.shredder = {
      getState: async () => structuredClone(state),
      onState: () => () => {},
      prepareDrop: rejectFileOperation,
      executeBatch: rejectFileOperation,
      choose: rejectFileOperation,
      updatePreferences: async () => structuredClone(state),
      beginPetDrag: async () => {},
      movePetDrag: () => {},
      endPetDrag: async () => {},
      openMain: async () => {},
      openPetSettings: async () => {},
      closePetSettings: async () => {},
      quit: async () => {},
    };
  }, { theme, grown, size: viewport.width / 300 });
  await page.goto(`${appUrl}?view=pet`);
  await page.locator('#creature svg').waitFor();
  await page.mouse.move(viewport.width / 2, viewport.height - 40);
  await expect(page.locator('#speech')).toBeVisible();
  return page;
}

try {
  for (const viewport of sizes) {
    for (const [theme, selector] of Object.entries(bodySelectors)) {
      for (const grown of [false, true]) {
        const name = `${theme} ${Math.round(viewport.width / 3)}% growth=${grown ? 1.3 : 1}`;
        const page = await createPetPage(viewport, theme, grown);
        try {
          const layout = await page.evaluate(selector => {
            const speech = document.querySelector('#speech').getBoundingClientRect();
            const body = { x: Infinity, y: Infinity, right: -Infinity, bottom: -Infinity };
            for (const shape of document.querySelector(selector).querySelectorAll('*')) {
              if (!(shape instanceof SVGGeometryElement)) continue;
              let visible = true;
              for (let ancestor = shape; ancestor instanceof SVGElement; ancestor = ancestor.parentElement) {
                const style = getComputedStyle(ancestor);
                if (Number(style.opacity) === 0 || style.display === 'none' || style.visibility === 'hidden') visible = false;
              }
              if (!visible) continue;
              const matrix = shape.getScreenCTM();
              const length = shape.getTotalLength();
              const style = getComputedStyle(shape);
              const stroke = style.stroke === 'none' ? 0 : Number.parseFloat(style.strokeWidth) / 2 * Math.hypot(matrix.a, matrix.b);
              // Sampling painted outlines avoids SVG group rectangles counting empty rotated corners.
              for (let step = 0; step <= 100; step += 1) {
                const point = shape.getPointAtLength(length * step / 100).matrixTransform(matrix);
                body.x = Math.min(body.x, point.x - stroke);
                body.y = Math.min(body.y, point.y - stroke);
                body.right = Math.max(body.right, point.x + stroke);
                body.bottom = Math.max(body.bottom, point.y + stroke);
              }
            }
            return {
              speech: { x: speech.x, y: speech.y, right: speech.right, bottom: speech.bottom },
              body,
              gap: body.y - speech.bottom,
              scale: Number(document.querySelector('#creature').style.getPropertyValue('--pet-scale')),
            };
          }, selector);
          records.push({ name, viewport, ...layout });
          assert.equal(layout.scale, grown ? 1.3 : 1, 'The test must reach the intended growth size.');
          assert.ok(layout.speech.x >= 0 && layout.speech.right <= viewport.width + 0.5, 'Speech must fit horizontally.');
          assert.ok(layout.speech.y >= 0 && layout.speech.bottom <= viewport.height, 'Speech must not clip vertically.');
          assert.ok(layout.gap >= 4 && layout.gap <= 38, `Speech must stay close without covering the body, gap=${layout.gap}.`);
          assert.ok(layout.body.x >= 0 && layout.body.right <= viewport.width + 0.5, 'The body must fit horizontally.');
          assert.ok(layout.body.y >= 0 && layout.body.bottom <= viewport.height + 0.5, 'The body must fit vertically.');
          if (theme === 'blade' && viewport.width === 165) {
            await page.screenshot({ path: resolve(`test-results/pet-spacing-tank${grown ? '-grown' : ''}.png`) });
          }
          console.log(`PASS ${name}: bubble gap ${layout.gap.toFixed(1)}px`);
        } catch (error) {
          failures.push(name);
          console.error(`FAIL ${name}: ${error.message}`);
          await page.screenshot({ path: resolve(`test-results/pet-spacing-${theme}-${viewport.width}-${grown ? 'grown' : 'initial'}-failure.png`) });
        } finally {
          await page.close();
        }
      }
    }
  }
  await writeFile(resolve('test-results/pet-spacing-results.json'), JSON.stringify(records, null, 2));
  assert.equal(failures.length, 0, `Pet spacing failures: ${failures.join(', ')}`);
  console.log(`PASS ${records.length} native-size pet layouts keep speech and body visible.`);
} finally {
  await browser.close();
}
