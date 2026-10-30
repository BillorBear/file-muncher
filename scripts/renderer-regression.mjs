import assert from 'node:assert/strict';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { chromium } from '@playwright/test';

const browser = await chromium.launch({ channel: 'chrome', headless: true });

try {
  const page = await browser.newPage();
  await page.addInitScript(() => {
    const initial = {
      preferences: { theme: 'munch', deletionMode: 'trash', petVisible: true, petSize: 0.7, reduceMotion: false },
      stats: { files: 0, bytes: 0, meals: 0 },
    };
    let stateListener;
    let executeCalls = 0;
    window.shredder = {
      getState: async () => structuredClone(initial),
      onState: listener => { stateListener = listener; return () => { stateListener = undefined; }; },
      choose: async () => ({
        token: 'renderer-regression-mock',
        entries: [{ id: 'mock', name: 'mock.txt', kind: 'file', fileCount: 1, bytes: 1 }],
        rejected: [],
        mode: 'trash',
      }),
      executeBatch: async () => {
        executeCalls += 1;
        const first = { ...initial, stats: { files: 1, bytes: 1, meals: 1 } };
        stateListener?.(structuredClone(first));
        setTimeout(() => stateListener?.({
          preferences: { ...initial.preferences, theme: 'pixel', deletionMode: 'permanent' },
          stats: { files: 2, bytes: 2, meals: 2 },
        }), 100);
        return {
          items: [{ name: 'mock.txt', status: 'success', fileCount: 1, bytes: 1 }],
          cancelled: false,
          state: first,
        };
      },
      prepareDrop: async () => { throw new Error('This regression uses no real files.'); },
      updatePreferences: async () => { throw new Error('This regression does not change preferences.'); },
      openMain: async () => {},
      openPetSettings: async () => {},
      closePetSettings: async () => {},
      beginPetDrag: async () => {},
      movePetDrag: () => {},
      endPetDrag: async () => {},
      quit: async () => {},
    };
    window.getRegressionExecuteCalls = () => executeCalls;
  });
  await page.goto(pathToFileURL(resolve('dist/index.html')).href);
  await page.locator('#choose-files').click();
  await page.waitForFunction(() => document.querySelector('[data-stat="files"]').textContent === '2');
  await page.waitForFunction(() => !document.body.classList.contains('is-busy'));
  const displayed = await page.evaluate(() => ({
    files: document.querySelector('[data-stat="files"]').textContent,
    mode: document.querySelector('#mode-badge span').textContent,
    theme: document.body.dataset.theme,
  }));
  assert.deepEqual(displayed, {
    files: '2', mode: '永久删除 · 每次确认', theme: 'pixel',
  }, 'A completed animation must preserve newer state broadcast by another window.');

  await page.locator('#preview').click();
  await page.waitForFunction(() => !document.body.classList.contains('is-busy'));
  assert.equal(await page.evaluate(() => window.getRegressionExecuteCalls()), 1,
    'Animation previews must not invoke file deletion.');
  assert.equal(await page.locator('[data-stat="files"]').textContent(), '2',
    'Animation previews must not alter successful file counts.');
  console.log('Renderer regression passed: cross-window state stays current; animation preview never deletes.');
} finally {
  await browser.close();
}
