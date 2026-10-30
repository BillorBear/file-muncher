import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { _electron as electron, expect } from '@playwright/test';

const profile = await mkdtemp(join(tmpdir(), 'file-muncher-file-drag-'));
let desktop;
const errors = [];

try {
  const executable = process.env.FILE_MUNCHER_EXECUTABLE;
  desktop = await electron.launch({ ...(executable ? { executablePath: executable } : {}), args: executable ? [] : [resolve('.')],
    env: { ...process.env, FILE_MUNCHER_USER_DATA: profile, FILE_MUNCHER_SMOKE: '1' }, timeout: 60_000 });
  await expect.poll(() => desktop.windows().length, { timeout: 30_000 }).toBe(2);
  for (const page of desktop.windows()) {
    page.on('pageerror', error => errors.push(error.message));
    await page.waitForURL(/view=(main|pet)$/);
  }
  const pet = desktop.windows().find(page => new URL(page.url()).searchParams.get('view') === 'pet');
  assert.ok(pet);
  await pet.locator('#creature svg').waitFor();
  await pet.evaluate(() => window.shredder.updatePreferences({ theme: 'blade', reduceMotion: true }));
  await desktop.evaluate(({ screen }) => {
    globalThis.pointerTest = { reads: 0 };
    screen.getCursorScreenPoint = () => {
      globalThis.pointerTest.reads += 1;
      return { x: -1900, y: -250 };
    };
  });
  await pet.mouse.move(10, 10);
  await pet.mouse.move(140, 160);
  await desktop.evaluate(async () => { await new Promise(resolve => setTimeout(resolve, 160)); });
  assert.equal(await desktop.evaluate(() => globalThis.pointerTest.reads), 0, 'Idle windows must not poll the global cursor.');
  assert.notEqual(await pet.locator('#drop-zone').getAttribute('data-looking'), 'true');
  await pet.evaluate(() => {
    const transfer = new DataTransfer();
    transfer.items.add(new File(['preview only'], 'not-dropped.txt'));
    document.querySelector('#creature').dispatchEvent(new DragEvent('dragover', {
      bubbles: true, dataTransfer: transfer, clientX: 160, clientY: 180,
    }));
  });
  await expect(pet.locator('#speech')).toHaveText('stand by !');
  assert.equal(await pet.locator('#drop-zone').getAttribute('data-tracking'), 'true');
  await pet.evaluate(() => document.dispatchEvent(new Event('dragend')));
  assert.notEqual(await pet.locator('#drop-zone').getAttribute('data-looking'), 'true');
  assert.equal((await pet.evaluate(() => window.shredder.getState())).stats.files, 0);

  await pet.evaluate(() => window.shredder.openPetSettings());
  await expect.poll(() => desktop.windows().some(page => page.url().includes('view=pet-settings'))).toBe(true);
  const settings = desktop.windows().find(page => page.url().includes('view=pet-settings'));
  await settings.locator('#pet-size').waitFor();
  await expect.poll(() => desktop.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().find(window => window.webContents.getURL().includes('view=pet-settings'))?.isFocused())).toBe(true);
  await settings.locator('#pet-size').click();
  assert.equal(await desktop.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().find(window => window.webContents.getURL().includes('view=pet-settings'))?.isVisible()), true,
    'Clicking inside the card must leave it open.');
  await desktop.evaluate(({ BrowserWindow }) => {
    const window = BrowserWindow.getAllWindows().find(window => window.webContents.getURL().includes('view=pet-settings'));
    globalThis.delayedDismissals = [];
    globalThis.originalSettingsSend = window.webContents.send.bind(window.webContents);
    window.webContents.send = (channel, ...args) => {
      if (channel === 'shredder:pet-settings-dismiss-requested') globalThis.delayedDismissals.push(args[0]);
      else globalThis.originalSettingsSend(channel, ...args);
    };
  });
  for (const [index, action] of ['refocus', 'reopen'].entries()) {
    await desktop.evaluate(({ app, BrowserWindow }) => {
      const main = BrowserWindow.getAllWindows().find(window => window.webContents.getURL().includes('view=main'));
      app.focus({ steal: true }); main.show(); main.focus();
    });
    await expect.poll(() => desktop.evaluate(() => globalThis.delayedDismissals.length)).toBe(index + 1);
    const requestId = await desktop.evaluate(() => globalThis.delayedDismissals.at(-1));
    if (action === 'reopen') await pet.evaluate(() => window.shredder.openPetSettings());
    else await desktop.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()
      .find(window => window.webContents.getURL().includes('view=pet-settings')).focus());
    await expect.poll(() => desktop.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()
      .find(window => window.webContents.getURL().includes('view=pet-settings'))?.isFocused())).toBe(true);
    await settings.evaluate(requestId => window.shredder.dismissPetSettings(requestId), requestId);
    assert.equal(settings.isClosed(), false, `A stale dismissal must not close settings after ${action}.`);
  }
  await desktop.evaluate(({ BrowserWindow }) => {
    const window = BrowserWindow.getAllWindows().find(window => window.webContents.getURL().includes('view=pet-settings'));
    window.webContents.send = globalThis.originalSettingsSend;
  });
  await desktop.evaluate(({ app, BrowserWindow }) => {
    const main = BrowserWindow.getAllWindows().find(window => window.webContents.getURL().includes('view=main'));
    app.focus({ steal: true }); main.show(); main.focus();
  });
  await expect.poll(() => desktop.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().some(window => window.webContents.getURL().includes('view=pet-settings') && window.isVisible()))).toBe(false);
  assert.deepEqual(errors, []);
  console.log('PASS: no idle cursor polling or gaze, real file-drag readiness, drag cleanup, inside-card interaction, stale-dismissal cancellation, outside-focus dismissal');
} finally {
  if (desktop) await desktop.close();
  await rm(profile, { recursive: true, force: true });
}
