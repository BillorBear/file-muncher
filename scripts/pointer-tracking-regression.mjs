import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { _electron as electron, expect } from '@playwright/test';

const profile = await mkdtemp(join(tmpdir(), 'file-muncher-pointer-'));
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
  await pet.evaluate(() => {
    window.pointerTest = { points: [], unsubscribe: null };
    window.pointerTest.unsubscribe = window.shredder.onPointerTarget(point => {
      window.pointerTest.points.push(point);
    });
  });
  const initial = await desktop.evaluate(({ BrowserWindow, screen }) => {
    const window = BrowserWindow.getAllWindows().find(item => item.webContents.getURL().endsWith('view=pet'));
    globalThis.pointerTest = { cursor: { x: -1900, y: -250 }, reads: 0 };
    screen.getCursorScreenPoint = () => {
      globalThis.pointerTest.reads += 1;
      return { ...globalThis.pointerTest.cursor };
    };
    window.webContents.setZoomFactor(1.5);
    return window.getContentBounds();
  });
  await expect.poll(() => pet.evaluate(() => window.pointerTest.points.at(-1))).toEqual({
    x: (-1900 - initial.x) / 1.5, y: (-250 - initial.y) / 1.5,
  });
  const firstCount = await pet.evaluate(() => window.pointerTest.points.length);
  await desktop.evaluate(async () => { await new Promise(resolve => setTimeout(resolve, 120)); });
  assert.equal(await pet.evaluate(() => window.pointerTest.points.length), firstCount,
    'Stationary cursor targets should not create repeated IPC events.');

  await desktop.evaluate(({ BrowserWindow }) => {
    for (const window of BrowserWindow.getAllWindows()) window.hide();
  });
  const hiddenReads = await desktop.evaluate(() => globalThis.pointerTest.reads);
  await desktop.evaluate(async () => { await new Promise(resolve => setTimeout(resolve, 160)); });
  assert.equal(await desktop.evaluate(() => globalThis.pointerTest.reads), hiddenReads,
    'Hiding both pet and main windows must stop desktop cursor polling.');
  assert.equal(await pet.evaluate(() => window.pointerTest.points.length), firstCount,
    'Hidden windows must not receive pointer targets.');

  const restored = await desktop.evaluate(({ BrowserWindow }) => {
    const window = BrowserWindow.getAllWindows().find(item => item.webContents.getURL().endsWith('view=pet'));
    globalThis.pointerTest.cursor = { x: 1800, y: 1000 };
    window.showInactive();
    return window.getContentBounds();
  });
  await expect.poll(() => pet.evaluate(() => window.pointerTest.points.at(-1))).toEqual({
    x: (1800 - restored.x) / 1.5, y: (1000 - restored.y) / 1.5,
  });
  assert.ok(await desktop.evaluate(() => globalThis.pointerTest.reads) > hiddenReads,
    'Showing the pet must resume cursor polling while the main window remains hidden.');

  const subscribedCount = await pet.evaluate(() => {
    window.pointerTest.unsubscribe();
    return window.pointerTest.points.length;
  });
  await desktop.evaluate(() => { globalThis.pointerTest.cursor = { x: 1200, y: 500 }; });
  await desktop.evaluate(async () => { await new Promise(resolve => setTimeout(resolve, 120)); });
  assert.equal(await pet.evaluate(() => window.pointerTest.points.length), subscribedCount,
    'Unsubscribing must remove the preload callback.');

  await desktop.evaluate(({ BrowserWindow }) => {
    BrowserWindow.getAllWindows().find(window => window.webContents.getURL().endsWith('view=pet')).destroy();
  });
  const closedReads = await desktop.evaluate(() => globalThis.pointerTest.reads);
  await desktop.evaluate(async () => { await new Promise(resolve => setTimeout(resolve, 160)); });
  assert.equal(await desktop.evaluate(() => globalThis.pointerTest.reads), closedReads,
    'Destroying the last visible pet window must stop cursor polling.');
  assert.deepEqual(errors, []);
  console.log('PASS: native pointer IPC, CSS zoom, outside-window targets, changed-only events, hidden/closed lifecycle, listener cleanup');
} finally {
  if (desktop) await desktop.close();
  await rm(profile, { recursive: true, force: true });
}
