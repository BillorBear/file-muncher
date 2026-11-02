import assert from 'node:assert/strict';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { chromium, expect } from '@playwright/test';

const browser = await chromium.launch({ channel: 'chrome', headless: true });
try {
  const page = await browser.newPage({ viewport: { width: 1120, height: 800 } });
  await page.goto(pathToFileURL(resolve('dist/index.html')).href);
  const dialog = page.locator('#settings-dialog');
  await page.locator('#settings').click();
  await expect(dialog).toBeVisible();
  await page.locator('input[value="permanent"]').check();
  await page.mouse.click(20, 400);
  await expect(dialog).not.toBeVisible();
  await expect(page.locator('#settings')).toBeFocused();
  await expect(page.locator('#mode-badge')).toContainText('回收站');

  await page.locator('#settings').click();
  await expect(page.locator('input[value="trash"]')).toBeChecked();
  await page.keyboard.press('Escape');
  await expect(dialog).not.toBeVisible();

  await page.locator('#settings').click();
  await page.locator('input[value="permanent"]').check();
  await page.locator('.save-settings').click();
  await expect(dialog).not.toBeVisible();
  await expect(page.locator('#mode-badge')).toContainText('永久删除');

  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.locator('#settings').click();
  await expect(dialog).toBeVisible();
  assert.equal(await dialog.evaluate(node => getComputedStyle(node).transform), 'none',
    'Reduced-motion drawers must not slide.');
  await page.keyboard.press('Escape');
  await expect(dialog).not.toBeVisible();
  console.log('Settings regression passed: backdrop/Escape dismissal, focus, draft cancellation, saved mode and reduced motion.');

  const delayed = await browser.newPage();
  await delayed.addInitScript(() => {
    let state = {
      preferences: { theme: 'munch', deletionMode: 'trash', petVisible: true, petSize: .7, reduceMotion: false },
      stats: { files: 0, bytes: 0, meals: 0 },
    };
    window.shredder = {
      getState: async () => state,
      onState: () => () => {},
      updatePreferences: patch => new Promise((resolve, reject) => {
        window.settleSettingsWrite = fail => {
          if (fail) reject(new Error('Disk write failed'));
          else { state = { ...state, preferences: { ...state.preferences, ...patch } }; resolve(state); }
        };
      }),
    };
  });
  await delayed.goto(pathToFileURL(resolve('dist/index.html')).href);
  await delayed.locator('#settings').click();
  await delayed.locator('#pref-size').fill('75');
  await delayed.locator('#close-settings').click();
  await expect(delayed.locator('.save-settings')).toBeDisabled();
  await expect(delayed.locator('#pref-size')).toBeDisabled();
  await delayed.evaluate(() => window.settleSettingsWrite(true));
  await expect(delayed.locator('#settings-dialog')).toBeVisible();
  await expect(delayed.locator('#settings-error')).toHaveText('Disk write failed');
  await expect(delayed.locator('.save-settings')).toBeEnabled();
  await delayed.locator('.save-settings').click();
  await delayed.keyboard.press('Escape');
  await expect(delayed.locator('#settings-dialog')).toBeVisible();
  await delayed.evaluate(() => window.settleSettingsWrite(true));
  await expect(delayed.locator('#settings-dialog')).toBeVisible();
  await expect(delayed.locator('#settings-error')).toHaveText('Disk write failed');
  console.log('Settings pending-write regression passed: close/save cannot race; failures stay visible.');
} finally {
  await browser.close();
}
