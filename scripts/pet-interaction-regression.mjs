import assert from 'node:assert/strict';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { chromium, expect } from '@playwright/test';

const browser = await chromium.launch({ channel: 'chrome', headless: true });
const failures = [];
const appUrl = pathToFileURL(resolve('dist/index.html')).href;

async function newPetPage(view = 'pet') {
  const page = await browser.newPage({ viewport: view === 'pet' ? { width: 500, height: 500 } : { width: 1200, height: 900 } });
  await page.clock.install({ time: new Date('2026-10-30T10:00:00Z') });
  await page.clock.pauseAt(new Date('2026-10-30T10:00:01Z'));
  await page.addInitScript(() => {
    let state = {
      preferences: { theme: 'munch', deletionMode: 'trash', petVisible: true, reduceMotion: true, petSize: 0.7 },
      stats: { files: 0, bytes: 0, meals: 0 },
    };
    let stateListener;
    let dismissListener;
    let dismissalSequence = 0;
    let pendingDismissal;
    let settingsFocused = true;
    let outcome = 'success';
    let delayNextDragBegin = false;
    let releaseDragBegin;
    let dragSessionActive = false;
    let holdPreferenceWrites = false;
    const pendingPreferenceWrites = [];
    const calls = { prepare: 0, execute: 0, openMain: 0, openPetSettings: 0, closePetSettings: 0, dismissPetSettings: [], preferences: [], drag: [] };
    const broadcast = () => stateListener?.(structuredClone(state));
    window.shredder = {
      getState: async () => structuredClone(state),
      onState: listener => { stateListener = listener; return () => { stateListener = undefined; }; },
      onPetSettingsDismissRequested: listener => { dismissListener = listener; return () => { dismissListener = undefined; }; },
      prepareDrop: async () => {
        calls.prepare += 1;
        return {
          token: 'synthetic-pet-interaction-test',
          entries: [{ id: 'synthetic', name: 'synthetic.txt', kind: 'file', fileCount: 1, bytes: 12 }],
          rejected: [], mode: 'trash',
        };
      },
      executeBatch: async () => {
        calls.execute += 1;
        if (outcome === 'success') {
          state = { ...state, stats: { files: state.stats.files + 1, bytes: state.stats.bytes + 12, meals: state.stats.meals + 1 } };
          broadcast();
        }
        return {
          items: [{ name: 'synthetic.txt', status: outcome, fileCount: outcome === 'success' ? 1 : 0, bytes: outcome === 'success' ? 12 : 0, message: outcome === 'error' ? 'Synthetic permission denial' : undefined }],
          cancelled: false,
          state: structuredClone(state),
        };
      },
      choose: async () => { throw new Error('Pet interaction tests never use a real file picker.'); },
      updatePreferences: async patch => {
        calls.preferences.push(structuredClone(patch));
        if (holdPreferenceWrites) await new Promise((resolve, reject) => { pendingPreferenceWrites.push({ resolve, reject }); });
        state = { ...state, preferences: { ...state.preferences, ...patch } };
        broadcast();
        return structuredClone(state);
      },
      beginPetDrag: async (...args) => {
        calls.drag.push({ method: 'begin', args });
        if (delayNextDragBegin) {
          delayNextDragBegin = false;
          await new Promise(resolve => { releaseDragBegin = resolve; });
        }
        dragSessionActive = true;
      },
      movePetDrag: (...args) => { calls.drag.push({ method: 'move', args }); },
      endPetDrag: async (...args) => { calls.drag.push({ method: 'end', args }); dragSessionActive = false; },
      openMain: async () => { calls.openMain += 1; },
      openPetSettings: async () => { calls.openPetSettings += 1; pendingDismissal = undefined; settingsFocused = true; },
      closePetSettings: async () => { calls.closePetSettings += 1; },
      dismissPetSettings: async requestId => {
        calls.dismissPetSettings.push(requestId);
        if (requestId !== pendingDismissal || settingsFocused) return;
        pendingDismissal = undefined;
        calls.closePetSettings += 1;
      },
      quit: async () => {},
    };
    window.petTest = {
      snapshot: () => structuredClone({ calls, state, dragSessionActive }),
      setOutcome: next => { outcome = next; },
      setPreferences: patch => { state.preferences = { ...state.preferences, ...patch }; broadcast(); },
      setStats: stats => { state.stats = { ...stats }; broadcast(); },
      delayDragBegin: () => { delayNextDragBegin = true; },
      releaseDragBegin: () => { releaseDragBegin?.(); releaseDragBegin = undefined; },
      holdPreferences: () => { holdPreferenceWrites = true; },
      blurSettings: () => {
        settingsFocused = false;
        pendingDismissal = ++dismissalSequence;
        dismissListener?.(pendingDismissal);
      },
      focusSettings: () => { settingsFocused = true; pendingDismissal = undefined; },
      resolveNextPreferences: () => {
        const pending = pendingPreferenceWrites.shift();
        if (!pending) throw new Error('No preference write is waiting.');
        pending.resolve();
      },
      rejectNextPreferences: () => {
        const pending = pendingPreferenceWrites.shift();
        if (!pending) throw new Error('No preference write is waiting.');
        pending.reject(new Error('Synthetic preference write failure'));
      },
    };
  });
  await page.goto(`${appUrl}?view=${view}`);
  if (view !== 'pet-settings') await page.locator('#creature svg').waitFor();
  await page.mouse.move(490, 490);
  return page;
}

async function run(name, test, view = 'pet') {
  const page = await newPetPage(view);
  try {
    await test(page);
    console.log(`PASS ${name}`);
  } catch (error) {
    failures.push(name);
    console.error(`FAIL ${name}\n${error.message}`);
  } finally {
    await page.close();
  }
}

async function dropSyntheticFile(page) {
  await page.evaluate(async () => {
    const transfer = new DataTransfer();
    transfer.items.add(new File(['test content'], 'synthetic.txt', { type: 'text/plain' }));
    document.querySelector('#drop-zone').dispatchEvent(new DragEvent('drop', { bubbles: true, dataTransfer: transfer }));
    await Promise.resolve();
    await Promise.resolve();
  });
  await page.clock.runFor(160);
}

try {
  await run('idle pet has no upper or lower cards and keeps its only bubble hidden', async page => {
    assert.equal(await page.locator('.pet-toolbar, .pet-info, #pet-menu, #pet-menu-button').count(), 0,
      'The desktop pet must not render upper controls or a lower information card.');
    assert.equal(await page.locator('#speech').count(), 1, 'The pet should have exactly one shared speech bubble.');
    assert.equal(await page.locator('#speech').evaluate(node => node.hidden), true,
      'The speech bubble should be hidden before any successful meal.');
  });

  await run('clicking the pet reacts without deleting files or changing growth', async page => {
    const before = await page.evaluate(() => window.petTest.snapshot());
    await page.locator('#creature').click();
    assert.equal(await page.locator('#drop-zone').getAttribute('data-interacting'), 'true',
      'A click should start the dedicated pet interaction animation.');
    const after = await page.evaluate(() => window.petTest.snapshot());
    assert.deepEqual(after.state.stats, before.state.stats, 'Petting must not grow deletion statistics.');
    assert.equal(after.calls.prepare, 0, 'Petting must not prepare file deletion.');
    assert.equal(after.calls.execute, 0, 'Petting must not execute file deletion.');
    await page.mouse.move(490, 490);
    assert.equal(await page.locator('#speech').evaluate(node => node.hidden), true,
      'Clicking must not leave a meal bubble after the pointer leaves.');
    await page.clock.runFor(2000);
    assert.notEqual(await page.locator('#drop-zone').getAttribute('data-interacting'), 'true',
      'Pet interaction animation should end instead of leaving the pet stuck in a reaction.');
  });

  await run('the single hover bubble includes statistics and disappears after leaving', async page => {
    await page.evaluate(() => window.petTest.setStats({ files: 3, bytes: 7168429, meals: 2 }));
    await page.locator('#creature').hover();
    assert.equal(await page.locator('#speech').evaluate(node => node.hidden), false,
      'Hovering the body should reveal the shared statistics bubble.');
    await expect(page.locator('#speech')).toContainText('3');
    await expect(page.locator('#speech')).toContainText('6.8 MB');
    await expect(page.locator('#speech')).toContainText('1.9 kg');
    await page.locator('#creature').click();
    await page.mouse.move(490, 490);
    assert.equal(await page.locator('#speech').evaluate(node => node.hidden), true,
      'Moving away must hide statistics even when the pet retains keyboard focus.');
  });

  await run('dragging the body moves the window without triggering petting', async page => {
    const box = await page.locator('#creature').boundingBox();
    assert.ok(box, 'Pet body must be available for dragging.');
    const x = box.x + box.width / 2;
    const y = box.y + box.height / 2;
    await page.mouse.move(x, y);
    await page.mouse.down();
    await page.mouse.move(x + 32, y + 18, { steps: 4 });
    await page.clock.runFor(32);
    await page.mouse.up();
    await page.clock.runFor(16);
    const { calls, state } = await page.evaluate(() => window.petTest.snapshot());
    assert.ok(calls.drag.some(call => call.method === 'begin'), 'Body dragging should begin a native window drag.');
    assert.ok(calls.drag.some(call => call.method === 'move'), 'Body dragging should request a native window move.');
    assert.equal(calls.drag.at(-1)?.method, 'end', 'Releasing the body should end the native drag.');
    assert.ok(calls.drag.every(call => call.args.length === 0), 'Drag IPC must not trust renderer-supplied screen coordinates.');
    assert.notEqual(await page.locator('#drop-zone').getAttribute('data-interacting'), 'true',
      'A drag must not also trigger the click animation.');
    assert.equal(calls.execute, 0, 'Dragging a pet must not delete anything.');
    assert.deepEqual(state.stats, { files: 0, bytes: 0, meals: 0 });
  });

  await run('drag captures its origin on pointerdown and keeps the first deliberate movement', async page => {
    const box = await page.locator('#creature').boundingBox();
    assert.ok(box);
    const x = box.x + box.width / 2;
    const y = box.y + box.height / 2;
    await page.mouse.move(x, y);
    await page.mouse.down();
    assert.deepEqual(await page.evaluate(() => window.petTest.snapshot().calls.drag.map(call => call.method)), ['begin'],
      'Pointerdown should capture the native cursor origin before the first movement.');
    await page.mouse.move(x + 2, y);
    assert.deepEqual(await page.evaluate(() => window.petTest.snapshot().calls.drag.map(call => call.method)), ['begin'],
      'A two-pixel tremor should not move the window.');
    await page.mouse.move(x + 24, y);
    assert.deepEqual(await page.evaluate(() => window.petTest.snapshot().calls.drag.map(call => call.method)), ['begin', 'move'],
      'The first movement past the threshold must move immediately from the original pointerdown position.');
    await page.mouse.up();
    const { calls, dragSessionActive } = await page.evaluate(() => window.petTest.snapshot());
    assert.equal(calls.drag.at(-1)?.method, 'end');
    assert.equal(dragSessionActive, false);
    assert.notEqual(await page.locator('#drop-zone').getAttribute('data-interacting'), 'true',
      'Completing a single-movement drag must not also pet the creature.');
  });

  await run('drag direction follows motion and release briefly lands without growing statistics', async page => {
    const creature = page.locator('#creature');
    const box = await creature.boundingBox();
    assert.ok(box);
    const x = box.x + box.width / 2;
    const y = box.y + box.height / 2;
    await page.mouse.move(x, y);
    await page.mouse.down();
    await page.mouse.move(x + 24, y);
    assert.equal(await creature.getAttribute('data-dragging'), 'true');
    assert.equal(await creature.getAttribute('data-drag-direction'), 'right');
    await page.mouse.move(x - 24, y);
    assert.equal(await creature.getAttribute('data-drag-direction'), 'left');
    await page.mouse.up();
    assert.notEqual(await creature.getAttribute('data-dragging'), 'true');
    assert.equal(await creature.getAttribute('data-drag-direction'), 'none');
    assert.equal(await creature.getAttribute('data-landing'), 'true');
    await page.clock.runFor(400);
    assert.notEqual(await creature.getAttribute('data-landing'), 'true', 'Landing should settle after a short reaction.');
    const { calls, state } = await page.evaluate(() => window.petTest.snapshot());
    assert.equal(calls.execute, 0);
    assert.equal(calls.prepare, 0);
    assert.deepEqual(state.stats, { files: 0, bytes: 0, meals: 0 });
  });

  await run('release before asynchronous drag start finishes still ends the session', async page => {
    const box = await page.locator('#creature').boundingBox();
    assert.ok(box);
    const x = box.x + box.width / 2;
    const y = box.y + box.height / 2;
    await page.evaluate(() => window.petTest.delayDragBegin());
    await page.mouse.move(x, y);
    await page.mouse.down();
    await page.mouse.move(x + 24, y);
    await page.mouse.up();
    assert.deepEqual(await page.evaluate(() => window.petTest.snapshot().calls.drag.map(call => call.method)), ['begin'],
      'A drag still awaiting native initialization cannot send a window move.');
    await page.evaluate(() => window.petTest.releaseDragBegin());
    await expect.poll(() => page.evaluate(() => window.petTest.snapshot().calls.drag.map(call => call.method))).toEqual(['begin', 'end']);
    assert.equal(await page.evaluate(() => window.petTest.snapshot().dragSessionActive), false,
      'Late native initialization must be followed by end, leaving no live drag session.');
    assert.notEqual(await page.locator('#drop-zone').getAttribute('data-interacting'), 'true',
      'Releasing a pending drag must not trigger a click reaction.');
    await page.locator('#creature').click();
    assert.equal(await page.locator('#drop-zone').getAttribute('data-interacting'), 'true',
      'After cleanup, the next ordinary click must work normally.');
    assert.equal(await page.evaluate(() => window.petTest.snapshot().dragSessionActive), false);
  });

  await run('right clicking opens the separate pet settings window without deleting', async page => {
    await page.locator('#creature').click({ button: 'right' });
    const { calls, state } = await page.evaluate(() => window.petTest.snapshot());
    assert.equal(calls.openPetSettings, 1);
    assert.equal(calls.execute, 0);
    assert.equal(calls.drag.length, 0, 'A context-menu click must not begin dragging.');
    assert.deepEqual(state.stats, { files: 0, bytes: 0, meals: 0 });
  });

  await run('separate settings size input persists immediately and closes through its own API', async page => {
    const slider = page.locator('#pet-size');
    await expect(slider).toHaveValue('70');
    assert.equal(await page.locator('#creature').count(), 0, 'Settings must not render a second pet scene.');
    assert.equal(await slider.getAttribute('min'), '50');
    assert.equal(await slider.getAttribute('max'), '100');
    await slider.evaluate(node => {
      node.value = '50';
      node.dispatchEvent(new Event('input', { bubbles: true }));
    });
    await page.clock.runFor(200);
    const { calls, state } = await page.evaluate(() => window.petTest.snapshot());
    assert.ok(calls.preferences.some(patch => patch.petSize === 0.5), 'Input should persist 50% without waiting for change or save.');
    assert.equal(state.preferences.petSize, 0.5);
    await page.evaluate(() => window.petTest.setPreferences({ petSize: 1 }));
    await expect(slider).toHaveValue('100');
    assert.equal(calls.execute, 0, 'Resizing must not delete any files.');
    await page.locator('#close-pet-settings').click();
    assert.equal(await page.evaluate(() => window.petTest.snapshot().calls.closePetSettings), 1);
  }, 'pet-settings');

  await run('rapid size inputs all reach IPC and closing waits for the final saved size', async page => {
    const slider = page.locator('#pet-size');
    await expect(slider).toHaveValue('70');
    await page.evaluate(() => window.petTest.holdPreferences());
    await slider.evaluate(input => {
      for (const value of ['60', '100']) {
        input.value = value;
        input.dispatchEvent(new Event('input', { bubbles: true }));
      }
    });
    assert.deepEqual(await page.evaluate(() => window.petTest.snapshot().calls.preferences), [{ petSize: 0.6 }, { petSize: 1 }],
      'Each input must reach the host immediately even while an earlier IPC is unresolved.');
    await page.locator('#close-pet-settings').click();
    assert.equal(await page.evaluate(() => window.petTest.snapshot().calls.closePetSettings), 0,
      'Closing must wait for outstanding preference writes.');
    await page.evaluate(() => window.petTest.resolveNextPreferences());
    await expect.poll(() => page.evaluate(() => window.petTest.snapshot().state.preferences.petSize)).toBe(0.6);
    assert.equal(await page.evaluate(() => window.petTest.snapshot().calls.closePetSettings), 0,
      'Completing only the first write must not close the settings window.');
    await expect(slider).toHaveValue('100');
    await page.evaluate(() => window.petTest.resolveNextPreferences());
    await expect.poll(() => page.evaluate(() => window.petTest.snapshot().calls.closePetSettings)).toBe(1);
    assert.equal(await page.evaluate(() => window.petTest.snapshot().state.preferences.petSize), 1);
    await expect(slider).toHaveValue('100');
  }, 'pet-settings');

  await run('a failed outstanding size write keeps the settings panel open with an error', async page => {
    const slider = page.locator('#pet-size');
    await expect(slider).toHaveValue('70');
    await page.evaluate(() => window.petTest.holdPreferences());
    await slider.evaluate(input => {
      for (const value of ['60', '100']) {
        input.value = value;
        input.dispatchEvent(new Event('input', { bubbles: true }));
      }
    });
    assert.equal(await page.evaluate(() => window.petTest.snapshot().calls.preferences.length), 2);
    await page.locator('#close-pet-settings').click();
    await page.evaluate(() => window.petTest.rejectNextPreferences());
    await page.evaluate(() => window.petTest.resolveNextPreferences());
    await expect(page.locator('#size-error')).toContainText('Synthetic preference write failure');
    await expect.poll(() => page.evaluate(() => window.petTest.snapshot().state.preferences.petSize)).toBe(1);
    assert.equal(await page.evaluate(() => window.petTest.snapshot().calls.closePetSettings), 0,
      'A failed write must not silently close the settings panel after a later write succeeds.');
    await expect(page.locator('.pet-settings-panel')).toBeVisible();
  }, 'pet-settings');

  await run('settings stay open for inside clicks and close after a native outside focus change', async page => {
    await page.locator('#pet-size').click();
    assert.equal(await page.evaluate(() => window.petTest.snapshot().calls.closePetSettings), 0);
    await page.evaluate(() => window.petTest.blurSettings());
    await expect.poll(() => page.evaluate(() => window.petTest.snapshot().calls.closePetSettings)).toBe(1);
    assert.deepEqual(await page.evaluate(() => window.petTest.snapshot().calls.dismissPetSettings), [1],
      'Native dismissal must echo its request token instead of using an unconditional close.');
  }, 'pet-settings');

  await run('desktop settings ignore renderer-only blur events', async page => {
    await page.evaluate(() => window.dispatchEvent(new Event('blur')));
    assert.equal(await page.evaluate(() => window.petTest.snapshot().calls.closePetSettings), 0,
      'Only native focus changes should dismiss desktop settings.');
  }, 'pet-settings');

  for (const writeResult of ['success', 'error']) {
    await run(`outside dismissal waits for size writes: ${writeResult}`, async page => {
      await page.evaluate(() => window.petTest.holdPreferences());
      await page.locator('#pet-size').evaluate(input => {
        input.value = '55';
        input.dispatchEvent(new Event('input', { bubbles: true }));
      });
      await page.evaluate(() => window.petTest.blurSettings());
      assert.equal(await page.evaluate(() => window.petTest.snapshot().calls.closePetSettings), 0);
      if (writeResult === 'success') {
        await page.evaluate(() => window.petTest.resolveNextPreferences());
        await expect.poll(() => page.evaluate(() => window.petTest.snapshot().calls.closePetSettings)).toBe(1);
        assert.equal(await page.evaluate(() => window.petTest.snapshot().state.preferences.petSize), 0.55);
      } else {
        await page.evaluate(() => window.petTest.rejectNextPreferences());
        await expect(page.locator('#size-error')).toContainText('Synthetic preference write failure');
        assert.equal(await page.evaluate(() => window.petTest.snapshot().calls.closePetSettings), 0);
        assert.deepEqual(await page.evaluate(() => window.petTest.snapshot().calls.dismissPetSettings), [],
          'A failed write must not acknowledge native dismissal.');
      }
    }, 'pet-settings');
  }

  for (const action of ['refocus', 'reopen']) {
    await run(`${action} cancels native dismissal while a size write is pending`, async page => {
      await page.evaluate(() => window.petTest.holdPreferences());
      await page.locator('#pet-size').evaluate(input => {
        input.value = '55';
        input.dispatchEvent(new Event('input', { bubbles: true }));
      });
      await page.evaluate(() => window.petTest.blurSettings());
      if (action === 'refocus') await page.evaluate(() => window.petTest.focusSettings());
      else await page.evaluate(() => window.shredder.openPetSettings());
      await page.evaluate(() => window.petTest.resolveNextPreferences());
      await expect.poll(() => page.evaluate(() => window.petTest.snapshot().calls.dismissPetSettings)).toEqual([1]);
      assert.equal(await page.evaluate(() => window.petTest.snapshot().calls.closePetSettings), 0,
        'An old blur must not close settings that the user has returned to.');
      await page.evaluate(() => window.petTest.blurSettings());
      await expect.poll(() => page.evaluate(() => window.petTest.snapshot().calls.closePetSettings)).toBe(1);
      assert.deepEqual(await page.evaluate(() => window.petTest.snapshot().calls.dismissPetSettings), [1, 2]);
    }, 'pet-settings');
  }

  await run('successful meal speech lasts two seconds and then clears', async page => {
    await dropSyntheticFile(page);
    assert.equal(await page.locator('#speech').evaluate(node => node.hidden), false,
      'Successful deletion should display the pet speech bubble.');
    assert.equal(await page.evaluate(() => window.petTest.snapshot().state.stats.files), 1);
    await page.clock.runFor(1999);
    assert.equal(await page.locator('#speech').evaluate(node => node.hidden), false,
      'Successful meal speech must remain visible until two seconds have elapsed.');
    await page.clock.runFor(1);
    assert.equal(await page.locator('#speech').evaluate(node => node.hidden), true,
      'Successful meal speech must disappear after two seconds.');
    assert.equal(await page.locator('#result-panel').evaluate(node => node.hidden), true,
      'An ordinary successful meal must not leave a persistent result card over the pet.');
  });

  await run('successful meal speech temporarily overrides hover statistics then restores them', async page => {
    await page.locator('#creature').hover();
    await dropSyntheticFile(page);
    const mealSpeech = await page.locator('#speech').textContent();
    assert.ok(mealSpeech);
    await page.clock.runFor(1999);
    assert.equal(await page.locator('#speech').textContent(), mealSpeech,
      'Hover state must not replace the success message before its two-second lifetime.');
    await page.clock.runFor(1);
    assert.equal(await page.locator('#speech').evaluate(node => node.hidden), false,
      'After the meal message ends, a still-hovered pet must show statistics.');
    assert.notEqual(await page.locator('#speech').textContent(), mealSpeech);
    await expect(page.locator('#speech')).toContainText('12 B');
    await page.mouse.move(490, 490);
    assert.equal(await page.locator('#speech').evaluate(node => node.hidden), true);
  });

  await run('failed deletion remains visible after the speech timeout', async page => {
    await page.evaluate(() => window.petTest.setOutcome('error'));
    await dropSyntheticFile(page);
    await page.clock.runFor(3000);
    assert.equal(await page.locator('#result-panel').evaluate(node => node.hidden), false,
      'A failed deletion must keep actionable feedback visible.');
    await expect(page.locator('#result-items')).toContainText('Synthetic permission denial');
    assert.equal(await page.locator('#speech').evaluate(node => node.hidden), true,
      'Failure details belong in the persistent result panel, not a meal-success bubble.');
    assert.equal(await page.evaluate(() => window.petTest.snapshot().state.stats.files), 0);
  });

  await run('all five pet styles support click reactions without file operations', async page => {
    for (const theme of ['munch', 'pixel', 'blade', 'void', 'paper']) {
      await page.evaluate(theme => window.petTest.setPreferences({ theme }), theme);
      await page.locator('#creature').click();
      assert.equal(await page.locator('body').getAttribute('data-theme'), theme);
      assert.equal(await page.locator('#drop-zone').getAttribute('data-interacting'), 'true',
        `${theme} should support pet interaction.`);
      assert.equal(await page.locator('#creature svg').count(), 1, `${theme} should render its own pet scene.`);
      await page.clock.runFor(2000);
    }
    const { calls, state } = await page.evaluate(() => window.petTest.snapshot());
    assert.equal(calls.execute, 0);
    assert.deepEqual(state.stats, { files: 0, bytes: 0, meals: 0 });
  });

  await run('main settings update pet size immediately while keeping other settings for save', async page => {
    await page.locator('#settings').click();
    const slider = page.locator('#pref-size');
    await expect(slider).toHaveValue('70');
    await page.locator('input[name="mode"][value="permanent"]').check();
    await slider.evaluate(node => {
      node.value = '60';
      node.dispatchEvent(new Event('input', { bubbles: true }));
    });
    await page.clock.runFor(200);
    const { calls, state } = await page.evaluate(() => window.petTest.snapshot());
    assert.ok(calls.preferences.some(patch => patch.petSize === 0.6), 'Main size input should persist without save.');
    assert.equal(state.preferences.petSize, 0.6);
    assert.equal(calls.execute, 0);
    await expect(page.locator('input[name="mode"][value="permanent"]')).toBeChecked();
    assert.equal(await page.evaluate(() => window.petTest.snapshot().state.preferences.deletionMode), 'trash');
    await page.locator('.save-settings').click();
    assert.equal(await page.evaluate(() => window.petTest.snapshot().state.preferences.deletionMode), 'permanent');
  }, 'main');
} finally {
  await browser.close();
}

if (failures.length) throw new Error(`${failures.length} pet interaction regression(s) failed: ${failures.join('; ')}`);
console.log('Pet interaction regressions passed; only synthetic files and mocked desktop IPC were used.');
