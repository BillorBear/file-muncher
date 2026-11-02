import assert from 'node:assert/strict';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { chromium, expect } from '@playwright/test';

const browser = await chromium.launch({ channel: 'chrome', headless: true });

async function assertFileInputSuppressed(page, context) {
  await page.evaluate(() => {
    window.emitLibraryFileDrag({ x: 500, y: 400 });
    const transfer = new DataTransfer();
    transfer.items.add(new File(['synthetic test content'], 'library-probe.txt', { type: 'text/plain' }));
    const zone = document.querySelector('#drop-zone');
    for (const type of ['dragenter', 'dragover', 'drop']) {
      zone.dispatchEvent(new DragEvent(type, { bubbles: true, cancelable: true, dataTransfer: transfer, clientX: 500, clientY: 400 }));
    }
  });
  assert.equal((await page.evaluate(() => window.getLibraryCalls())).fileCalls, 0,
    `${context} must not accept file input.`);
  assert.notEqual(await page.locator('#drop-zone').getAttribute('data-looking'), 'true',
    `${context} must not track external files.`);
  assert.notEqual(await page.locator('#drop-zone').getAttribute('data-tracking'), 'true');
  assert.notEqual(await page.locator('#drop-zone').getAttribute('data-phase'), 'hover');
  await page.evaluate(() => window.emitLibraryFileDrag(null));
}

try {
  const page = await browser.newPage({ viewport: { width: 940, height: 760 } });
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.addInitScript(() => {
    let state = {
      preferences: { theme: 'munch', deletionMode: 'trash', petVisible: true, petSize: .7, reduceMotion: false },
      stats: { files: 0, bytes: 0, meals: 0 },
    };
    let stateListener;
    let fileDragListener;
    let failChoice = false;
    let failCompanion = false;
    let delayChoice = false;
    let themeWrites = 0;
    let fileCalls = 0;
    window.shredder = {
      getState: async () => structuredClone(state),
      onState: listener => { stateListener = listener; return () => {}; },
      onGlobalFileDrag: listener => { fileDragListener = listener; return () => {}; },
      updatePreferences: async patch => {
        if (failCompanion && typeof patch.petVisible === 'boolean') throw new Error('无法保存桌面陪伴设置。');
        if (patch.theme) {
          themeWrites += 1;
          if (delayChoice) await new Promise(resolve => { window.resolveLibraryChoice = resolve; });
          if (failChoice) throw new Error('无法保存伙伴，请重试。');
        }
        state = { ...state, preferences: { ...state.preferences, ...patch } };
        stateListener?.(structuredClone(state));
        return structuredClone(state);
      },
      choose: async () => {
        fileCalls += 1;
        await new Promise(resolve => { window.cancelLibraryPicker = resolve; });
        return null;
      },
      prepareDrop: async () => { fileCalls += 1; throw new Error('Library tests must not access files.'); },
      executeBatch: async () => { fileCalls += 1; throw new Error('Library tests must not delete files.'); },
    };
    window.setLibraryFailure = value => { failChoice = value; };
    window.setCompanionFailure = value => { failCompanion = value; };
    window.setLibraryPending = value => { delayChoice = value; };
    window.getLibraryCalls = () => ({ themeWrites, fileCalls });
    window.emitLibraryFileDrag = point => fileDragListener?.(point);
  });
  await page.goto(pathToFileURL(resolve('dist/index.html')).href);
  await expect(page.locator('#home-view')).toBeVisible();
  await expect(page.locator('#library-view')).toBeHidden();
  assert.equal(await page.locator('#home-view [data-select-theme]').count(), 0,
    'Home must not contain the old pet collection.');

  await page.evaluate(() => window.emitLibraryFileDrag({ x: 500, y: 400 }));
  await expect(page.locator('#drop-zone')).toHaveAttribute('data-looking', 'true');
  await page.locator('#open-library').click();
  const library = page.locator('#library-view');
  await expect(library).toBeVisible();
  await expect(page.locator('#home-view')).toBeHidden();
  await expect(library.locator('.library-card:visible')).toHaveCount(6);
  assert.equal(await library.locator('.library-grid').evaluate(node => getComputedStyle(node).gridTemplateColumns.split(' ').length), 3,
    'A 940 px window should display three pet columns.');
  await assertFileInputSuppressed(page, 'The pet library');
  await page.setViewportSize({ width: 760, height: 760 });
  assert.equal(await library.locator('.library-grid').evaluate(node => getComputedStyle(node).gridTemplateColumns.split(' ').length), 2,
    'A compact window should display two pet columns.');
  await page.setViewportSize({ width: 940, height: 760 });
  await page.evaluate(() => window.setCompanionFailure(true));
  await page.locator('#toggle-pet').click();
  await expect(page.locator('#library-error')).toBeVisible();
  await expect(page.locator('#library-error')).toHaveText('无法保存桌面陪伴设置。');
  await expect(page.locator('#toggle-pet')).toHaveAttribute('aria-pressed', 'true');
  await page.evaluate(() => window.setCompanionFailure(false));
  await page.locator('#toggle-pet').click();
  await expect(page.locator('#toggle-pet')).toHaveAttribute('aria-pressed', 'false');
  await expect(page.locator('#library-error')).toBeEmpty();
  await expect(library.locator('[data-select-theme="munch"]')).toHaveAttribute('aria-pressed', 'true');
  await library.locator('[data-select-theme="munch"]').click();
  await expect(page.locator('#home-view')).toBeVisible();
  assert.equal((await page.evaluate(() => window.getLibraryCalls())).themeWrites, 0,
    'Returning with the selected pet must not rewrite preferences.');

  await page.locator('#open-library').click();
  await page.locator('#pet-search').fill('   像素   ');
  await expect(library.locator('.library-card:visible')).toHaveCount(1);
  await expect(page.locator('#pet-search')).toBeFocused();
  await page.locator('#pet-search').fill('<img src=x onerror=alert(1)>');
  await expect(library.locator('.library-card:visible')).toHaveCount(0);
  await expect(page.locator('#library-empty')).toBeVisible();
  assert.equal(await library.locator('img[src="x"]').count(), 0, 'Search text must never become HTML.');
  await page.locator('#reset-pet-search').click();
  await expect(page.locator('#pet-search')).toHaveValue('');
  await expect(library.locator('.library-card:visible')).toHaveCount(6);
  await page.locator('#pet-search').fill('机器人');
  await expect(library.locator('.library-card:visible')).toHaveCount(1);
  await page.locator('#clear-pet-search').click();
  await expect(library.locator('.library-card:visible')).toHaveCount(6);

  await library.locator('[data-select-theme="pixel"]').click();
  await expect(page.locator('#home-view')).toBeVisible();
  await expect(page.locator('body')).toHaveAttribute('data-theme', 'pixel');
  await page.locator('#open-library').click();
  await expect(library.locator('[data-select-theme="pixel"]')).toHaveAttribute('aria-pressed', 'true');

  await page.evaluate(() => window.setLibraryFailure(true));
  await library.locator('[data-select-theme="blade"]').click();
  await expect(library).toBeVisible();
  await expect(page.locator('#library-error')).toHaveText('无法保存伙伴，请重试。');
  await expect(library.locator('[data-select-theme="blade"]')).toBeEnabled();
  await expect(library.locator('[data-select-theme="pixel"]')).toHaveAttribute('aria-pressed', 'true');
  await page.evaluate(() => window.setLibraryFailure(false));
  await library.locator('[data-select-theme="blade"]').click();
  await expect(page.locator('#home-view')).toBeVisible();
  await expect(page.locator('body')).toHaveAttribute('data-theme', 'blade');

  await page.locator('#open-library').click();
  await page.evaluate(() => window.setLibraryPending(true));
  await library.locator('[data-select-theme="void"]').click();
  await expect(library.locator('[data-select-theme]:disabled')).toHaveCount(6);
  await expect(page.locator('#open-library')).toBeDisabled();
  await expect(page.locator('#nav-home')).toBeDisabled();
  await expect(library).toBeVisible();
  await expect(page.locator('#home-view')).toBeHidden();
  await page.evaluate(() => { window.setLibraryPending(false); window.resolveLibraryChoice(); });
  await expect(page.locator('#home-view')).toBeVisible();
  await expect(page.locator('body')).toHaveAttribute('data-theme', 'void');

  await page.locator('#open-library').click();
  await page.locator('#nav-home').click();
  await expect(page.locator('#home-view')).toBeVisible();
  assert.equal((await page.evaluate(() => window.getLibraryCalls())).fileCalls, 0);

  await page.locator('#open-library').click();
  for (const query of ['猪波', '眼镜', '小猪']) {
    await page.locator('#pet-search').fill(query);
    await expect(library.locator('.library-card:visible')).toHaveCount(1);
    await expect(library.locator('[data-library-theme="pig"]')).toBeVisible();
  }
  await library.locator('[data-select-theme="pig"]').click();
  await expect(page.locator('body')).toHaveAttribute('data-theme', 'pig');
  await expect(page.locator('#theme-title')).toHaveText('猪波');
  await expect(page.locator('#creature .pig-portrait')).toBeVisible();
  for (const portrait of [page.locator('#creature .pig-portrait'), library.locator('.pig-portrait')]) {
    assert.deepEqual(await portrait.evaluate(node => {
      const style = getComputedStyle(node);
      return { width: style.width, height: style.height, overflow: style.overflow };
    }), { width: '224px', height: '224px', overflow: 'hidden' }, 'Only one sprite cell may be visible in each scene.');
  }
  const spriteSize = await page.evaluate(async () => {
    const sprite = new Image();
    sprite.src = document.querySelector('#creature .pig-frame-idle').getAttribute('href');
    await sprite.decode();
    return { width: sprite.naturalWidth, height: sprite.naturalHeight };
  });
  assert.deepEqual(spriteSize, { width: 1254, height: 1254 }, 'The built app must include the full four-expression sprite sheet.');
  await page.locator('#open-library').click();
  await expect(library.locator('[data-select-theme="pig"]')).toHaveAttribute('aria-pressed', 'true');
  await page.locator('#clear-pet-search').click();
  await page.locator('#nav-home').click();

  await page.locator('#settings').click();
  await expect(page.locator('#settings-dialog')).toBeVisible();
  await assertFileInputSuppressed(page, 'An open settings drawer');
  await page.keyboard.press('Escape');
  await expect(page.locator('#settings-dialog')).toBeHidden();

  await page.locator('#preview').click();
  await expect(page.locator('#open-library')).toBeDisabled();
  await expect(page.locator('#nav-home')).toBeDisabled();
  await expect(page.locator('#preview')).toBeEnabled();
  assert.equal((await page.evaluate(() => window.getLibraryCalls())).fileCalls, 0,
    'Animation previews must not call file APIs.');

  await page.locator('#choose-files').click();
  await expect(page.locator('#open-library')).toBeDisabled();
  await expect(page.locator('#nav-home')).toBeDisabled();
  await page.evaluate(() => window.cancelLibraryPicker());
  await expect(page.locator('#choose-files')).toBeEnabled();
  await expect(page.locator('#open-library')).toBeEnabled();
  assert.deepEqual(errors, []);
  console.log('Pet library regression passed: navigation isolation, responsive search, selection/retry and suppressed file input.');
} finally {
  await browser.close();
}
