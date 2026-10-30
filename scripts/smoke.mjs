import { _electron as electron, expect } from '@playwright/test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, access, rm } from 'node:fs/promises';
import { join, resolve, sep } from 'node:path';
import { tmpdir } from 'node:os';

const temporary = await mkdtemp(join(tmpdir(), 'file-muncher-smoke-'));
const profile = join(temporary, 'profile');
const fixtures = join(temporary, 'fixtures');
await mkdir(fixtures);
await mkdir('test-results', { recursive: true });
const errors = [];
let desktop;
async function launch() {
  const executable = process.env.FILE_MUNCHER_EXECUTABLE;
  desktop = await electron.launch({ ...(executable ? { executablePath: executable } : {}), args: executable ? [] : [resolve('.')], env: { ...process.env, FILE_MUNCHER_USER_DATA: profile, FILE_MUNCHER_SMOKE: '1' }, timeout: 60_000 });
  await expect.poll(() => desktop.windows().length, { timeout: 30_000 }).toBe(2);
  for (const page of desktop.windows()) { page.on('pageerror', error => errors.push(error.message)); await page.waitForURL(/view=(main|pet)$/); }
  const main = desktop.windows().find(page => new URL(page.url()).searchParams.get('view') === 'main');
  const pet = desktop.windows().find(page => new URL(page.url()).searchParams.get('view') === 'pet');
  await expect(main.locator('#theme-title')).toHaveText('贪吃阿噗');
  await expect(main.locator('.brand')).toContainText('文件阿呜');
  await expect(main.locator('.brand')).toContainText(/file muncher/i);
  await pet.locator('#creature svg').waitFor();
  assert.equal(await pet.locator('.pet-toolbar, .pet-info, #pet-menu').count(), 0);
  await desktop.evaluate(({ app, BrowserWindow }) => {
    const window = BrowserWindow.getAllWindows().find(item => item.webContents.getURL().includes('view=main'));
    window.show(); window.focus(); app.focus({ steal: true });
  });
  await main.screenshot({ path: 'test-results/startup.png' });
  return { main, pet };
}
async function drop(page, filePath) {
  assert.ok(filePath.startsWith(fixtures + sep), 'Smoke tests may only drop their own generated fixtures.');
  await page.evaluate(() => { const input = document.createElement('input'); input.type = 'file'; input.id = 'smoke-file-input'; input.hidden = true; document.body.append(input); });
  await page.locator('#smoke-file-input').setInputFiles(filePath);
  await page.evaluate(() => {
    const input = document.querySelector('#smoke-file-input');
    const transfer = new DataTransfer();
    for (const file of input.files) transfer.items.add(file);
    document.querySelector('#drop-zone').dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: transfer }));
    input.remove();
  });
  await expect(page.locator('#drop-zone')).toHaveAttribute('aria-busy', 'false', { timeout: 20_000 });
}
async function choosePath(path) {
  assert.ok(path.startsWith(temporary + sep), 'Smoke tests may only select their own temporary directories.');
  await desktop.evaluate(({ dialog }, chosen) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [chosen] }); }, path);
}
async function exists(path) { try { await access(path); return true; } catch { return false; } }
async function petBounds() {
  return desktop.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().find(window => new URL(window.webContents.getURL()).searchParams.get('view') === 'pet').getBounds());
}
async function petSize() {
  const { width, height } = await petBounds();
  return { width, height };
}
async function petSettingsBounds() {
  return desktop.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().find(window => new URL(window.webContents.getURL()).searchParams.get('view') === 'pet-settings').getBounds());
}
function assertSeparate(bounds, other) {
  const overlaps = bounds.x < other.x + other.width && bounds.x + bounds.width > other.x &&
    bounds.y < other.y + other.height && bounds.y + bounds.height > other.y;
  assert.equal(overlaps, false, 'The settings panel must not cover the pet while it resizes.');
}
try {
  let { main, pet } = await launch();
  assert.equal(await pet.evaluate(() => getComputedStyle(document.documentElement).backgroundColor), 'rgba(0, 0, 0, 0)');
  assert.equal((await pet.evaluate(() => window.shredder.getState())).preferences.petSize, 0.7);
  assert.deepEqual(await petSize(), { width: 210, height: 242 }, 'The default desktop pet should use a compact 70% window.');
  const initialPetBounds = await petBounds();
  await assert.rejects(() => main.evaluate(() => window.shredder.beginPetDrag()), /只有桌面宠物窗口/);
  await assert.rejects(() => main.evaluate(() => window.shredder.endPetDrag()), /只有桌面宠物窗口/);
  await assert.rejects(() => main.evaluate(() => window.shredder.openPetSettings()), /只有桌面宠物窗口/);
  await main.evaluate(() => window.shredder.movePetDrag());
  assert.deepEqual(await petBounds(), initialPetBounds, 'Main-window drag IPC must not move the desktop pet.');
  await pet.evaluate(async () => { await window.shredder.beginPetDrag(); await window.shredder.endPetDrag(); });
  await pet.locator('#creature').click({ button: 'right' });
  await expect.poll(() => desktop.windows().filter(page => new URL(page.url()).searchParams.get('view') === 'pet-settings').length).toBe(1);
  const petSettings = desktop.windows().find(page => new URL(page.url()).searchParams.get('view') === 'pet-settings');
  petSettings.on('pageerror', error => errors.push(error.message));
  await expect(petSettings.locator('#pet-size')).toHaveValue('70');
  assert.equal(await petSettings.locator('#creature').count(), 0);
  await assert.rejects(() => pet.evaluate(() => window.shredder.closePetSettings()), /只有宠物设置窗口/);
  await assert.rejects(() => petSettings.evaluate(() => window.shredder.choose('files')), /此窗口不能处理文件/);
  await assert.rejects(() => petSettings.evaluate(() => window.shredder.executeBatch('unauthorized-settings-test')), /此窗口不能处理文件/);
  const protectedFixture = join(fixtures, 'settings-must-not-delete.txt');
  await writeFile(protectedFixture, 'Settings windows cannot prepare or delete this fixture.');
  await petSettings.evaluate(() => { const input = document.createElement('input'); input.type = 'file'; input.id = 'permission-file-input'; input.hidden = true; document.body.append(input); });
  await petSettings.locator('#permission-file-input').setInputFiles(protectedFixture);
  await assert.rejects(() => petSettings.evaluate(() => window.shredder.prepareDrop([...document.querySelector('#permission-file-input').files])), /此窗口不能处理文件/);
  assert.equal(await exists(protectedFixture), true);
  await petSettings.evaluate(() => document.querySelector('#permission-file-input').remove());
  const initialSettingsBounds = await petSettingsBounds();
  assert.deepEqual({ width: initialSettingsBounds.width, height: initialSettingsBounds.height }, { width: 260, height: 180 });
  assertSeparate(initialSettingsBounds, await petBounds());
  await petSettings.locator('#pet-size').evaluate(input => {
    input.value = '50';
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await expect.poll(() => petSize()).toEqual({ width: 150, height: 194 });
  await expect.poll(async () => (await pet.evaluate(() => window.shredder.getState())).preferences.petSize).toBe(0.5);
  assert.deepEqual(await petSettingsBounds(), initialSettingsBounds, 'Resizing should keep settings stationary.');
  assertSeparate(await petSettingsBounds(), await petBounds());
  await petSettings.locator('#pet-size').evaluate(input => {
    input.value = '100';
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await expect.poll(() => petSize()).toEqual({ width: 300, height: 315 });
  assert.deepEqual(await petSettingsBounds(), initialSettingsBounds, 'Enlarging the pet must not move the settings panel.');
  assertSeparate(await petSettingsBounds(), await petBounds());
  await petSettings.locator('#pet-size').evaluate(input => {
    input.value = '50';
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await expect.poll(() => petSize()).toEqual({ width: 150, height: 194 });
  await petSettings.locator('#close-pet-settings').click();
  await expect.poll(() => desktop.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().find(window => new URL(window.webContents.getURL()).searchParams.get('view') === 'pet-settings')?.isVisible() ?? false)).toBe(false);
  assert.deepEqual(await desktop.evaluate(({ BrowserWindow }) => Object.fromEntries(BrowserWindow.getAllWindows().filter(window => ['main', 'pet'].includes(new URL(window.webContents.getURL()).searchParams.get('view'))).map(window => [new URL(window.webContents.getURL()).searchParams.get('view'), window.isVisible()]))), { main: true, pet: true },
    'Closing settings must leave both main and pet windows visible.');
  console.log('PASS: compact pet, stationary separate settings, live resizing without overlap, settings file-operation denial, pet-only IPC authorization');
  for (const theme of ['munch', 'pixel', 'blade', 'void', 'paper']) {
    await main.locator(`[data-select-theme="${theme}"]`).click();
    await expect(main.locator('body')).toHaveAttribute('data-theme', theme);
    await expect(pet.locator('body')).toHaveAttribute('data-theme', theme);
    await main.screenshot({ path: `test-results/main-${theme}.png` });
    await main.locator('#preview').click();
    await expect(main.locator('#drop-zone')).toHaveAttribute('data-phase', 'processing');
    await main.screenshot({ path: `test-results/animation-${theme}.png` });
    await expect(main.locator('#drop-zone')).toHaveAttribute('aria-busy', 'false', { timeout: 6000 });
  }
  assert.deepEqual((await main.evaluate(() => window.shredder.getState())).stats, { files: 0, bytes: 0, meals: 0 });
  await main.locator('[data-select-theme="munch"]').click();
  await main.locator('#settings').click();
  await main.locator('#pref-motion').check();
  await expect(main.locator('#pref-size')).toHaveValue('50');
  await main.locator('#pref-size').evaluate(input => {
    input.value = '60';
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await expect.poll(() => petSize()).toEqual({ width: 180, height: 218 });
  await main.locator('.save-settings').click();
  const sample = join(fixtures, 'muncher-test-中文 sample.txt');
  await writeFile(sample, 'A safe temporary snack.');
  await drop(main, sample);
  assert.equal(await exists(sample), false, await main.locator('#result-panel').innerText());
  await expect(main.locator('[data-stat="files"]')).toHaveText('1');
  await pet.locator('#creature').hover();
  await expect(pet.locator('#speech')).toContainText('1 个文件');
  await pet.mouse.move(0, 0);
  await expect(pet.locator('#speech')).toBeHidden();
  console.log('PASS: five themes, non-destructive previews, native File bridge, real system trash, shared statistics');

  await main.evaluate(() => window.shredder.updatePreferences({ deletionMode: 'permanent' }));
  const permanent = join(fixtures, 'permanent-test.txt');
  await writeFile(permanent, 'Only delete this generated fixture.');
  await desktop.evaluate(({ dialog }) => { dialog.showMessageBox = async () => ({ response: 0, checkboxChecked: false }); });
  await drop(main, permanent);
  assert.equal(await exists(permanent), true);
  assert.equal((await main.evaluate(() => window.shredder.getState())).stats.files, 1);
  await desktop.evaluate(({ dialog }) => { dialog.showMessageBox = async () => ({ response: 1, checkboxChecked: false }); });
  await drop(main, permanent);
  assert.equal(await exists(permanent), false);
  assert.equal((await main.evaluate(() => window.shredder.getState())).stats.files, 2);
  console.log('PASS: cancellation preserves files and statistics; confirmed permanent deletion removes only test fixture');

  await main.evaluate(() => window.shredder.updatePreferences({ deletionMode: 'trash' }));
  const directory = join(fixtures, 'muncher-folder-test');
  await mkdir(join(directory, 'nested'), { recursive: true });
  await writeFile(join(directory, 'one.txt'), 'One');
  await writeFile(join(directory, 'nested', 'two.txt'), 'Two');
  await choosePath(directory);
  await main.locator('#choose-folder').click();
  await expect(main.locator('#drop-zone')).toHaveAttribute('aria-busy', 'false', { timeout: 20_000 });
  assert.equal(await exists(directory), false);
  assert.equal((await main.evaluate(() => window.shredder.getState())).stats.files, 4);

  await choosePath(profile);
  await main.locator('#choose-folder').click();
  await expect(main.locator('#drop-zone')).toHaveAttribute('aria-busy', 'false', { timeout: 20_000 });
  assert.equal((await main.evaluate(() => window.shredder.getState())).stats.files, 4);
  await expect(main.locator('#result-title')).toHaveText('这些文件暂时不能喂给我');
  await expect(main.locator('#result-items')).toContainText('保护目录');
  console.log('PASS: recursive directory meal, protected temporary application data directory refusal');

  await desktop.evaluate(({ BrowserWindow }) => { BrowserWindow.getAllWindows().find(window => window.webContents.getURL().includes('view=main')).close(); });
  await expect.poll(() => desktop.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().find(window => window.webContents.getURL().includes('view=main')).isVisible())).toBe(false);
  assert.equal(await desktop.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().find(window => new URL(window.webContents.getURL()).searchParams.get('view') === 'pet').isVisible()), true);
  const petFood = join(fixtures, 'pet-only-test.txt');
  await writeFile(petFood, 'Desktop pet still works.');
  await drop(pet, petFood);
  assert.equal(await exists(petFood), false);
  const expected = await pet.evaluate(() => window.shredder.getState());
  assert.equal(expected.stats.files, 5);
  await expect(pet.locator('#speech')).toBeVisible();
  await expect(pet.locator('#result-panel')).toBeHidden();
  await expect(pet.locator('#speech')).toBeHidden({ timeout: 3000 });
  await pet.screenshot({ path: 'test-results/pet.png', omitBackground: true });
  await pet.evaluate(() => window.shredder.openMain());
  await expect.poll(() => desktop.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().find(window => window.webContents.getURL().includes('view=main')).isVisible())).toBe(true);
  const saved = JSON.parse(await readFile(join(profile, 'state.json'), 'utf8'));
  assert.deepEqual(saved.stats, expected.stats);
  assert.equal(saved.preferences.petSize, 0.6);
  await desktop.close(); desktop = undefined;
  ({ main, pet } = await launch());
  assert.deepEqual((await main.evaluate(() => window.shredder.getState())).stats, expected.stats);
  assert.equal((await main.evaluate(() => window.shredder.getState())).preferences.petSize, 0.6);
  assert.deepEqual(await petSize(), { width: 180, height: 218 }, 'Restart should retain the chosen native pet size.');
  await main.screenshot({ path: 'test-results/main-grown.png' });
  assert.deepEqual(errors, []);
  console.log('PASS: closed main window retains functioning pet, timed speech, reopen, persisted growth and native size after restart, no renderer errors');
} finally {
  if (desktop) await desktop.close();
  await rm(temporary, { recursive: true, force: true });
}
