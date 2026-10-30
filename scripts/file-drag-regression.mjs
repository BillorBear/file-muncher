import assert from 'node:assert/strict';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { chromium, expect } from '@playwright/test';

const browser = await chromium.launch({ channel: 'chrome', headless: true });
const appUrl = pathToFileURL(resolve('dist/index.html')).href;
const failures = [];
const themes = ['munch', 'pixel', 'blade', 'void', 'paper'];

async function newPage(view) {
  const page = await browser.newPage({ viewport: view === 'pet' ? { width: 500, height: 500 } : { width: 1200, height: 900 } });
  page.setDefaultTimeout(2500);
  await page.clock.install({ time: new Date('2026-10-30T10:00:00Z') });
  await page.clock.pauseAt(new Date('2026-10-30T10:00:01Z'));
  await page.addInitScript(() => {
    let state = {
      preferences: { theme: 'blade', deletionMode: 'trash', petVisible: true, reduceMotion: false, petSize: 0.7 },
      stats: { files: 0, bytes: 0, meals: 0 },
    };
    let listener;
    let outcome = 'success';
    let rejectPreparation = false;
    let holdExecution = false;
    let releaseExecution;
    const calls = { prepare: 0, execute: 0, choose: 0 };
    const broadcast = () => listener?.(structuredClone(state));
    window.shredder = {
      getState: async () => structuredClone(state),
      onState: next => { listener = next; return () => { listener = undefined; }; },
      prepareDrop: async files => {
        calls.prepare += 1;
        if (files.length !== 1 || files[0].name !== 'synthetic.txt') throw new Error('Only synthetic files are permitted in this regression.');
        return {
          token: 'synthetic-file-drag-test',
          entries: rejectPreparation ? [] : [{ id: 'synthetic', name: 'synthetic.txt', kind: 'file', fileCount: 1, bytes: 12 }],
          rejected: rejectPreparation ? [{ name: 'synthetic.txt', message: 'Synthetic file rejected' }] : [],
          mode: 'trash',
        };
      },
      executeBatch: async () => {
        calls.execute += 1;
        if (holdExecution) await new Promise(resolve => { releaseExecution = resolve; });
        if (outcome === 'success') {
          state.stats = { files: state.stats.files + 1, bytes: state.stats.bytes + 12, meals: state.stats.meals + 1 };
          broadcast();
        }
        return {
          items: outcome === 'cancelled' ? [] : [{ name: 'synthetic.txt', status: outcome, fileCount: outcome === 'success' ? 1 : 0, bytes: outcome === 'success' ? 12 : 0, message: outcome === 'error' ? 'Synthetic permission denial' : undefined }],
          cancelled: outcome === 'cancelled',
          state: structuredClone(state),
        };
      },
      choose: async () => { calls.choose += 1; throw new Error('File drag tests never use a real file picker.'); },
      updatePreferences: async patch => { state.preferences = { ...state.preferences, ...patch }; broadcast(); return structuredClone(state); },
      beginPetDrag: async () => {}, movePetDrag: () => {}, endPetDrag: async () => {},
      openMain: async () => {}, openPetSettings: async () => {}, closePetSettings: async () => {}, quit: async () => {},
    };
    window.fileDragTest = {
      snapshot: () => structuredClone({ state, calls }),
      setPreferences: patch => { state.preferences = { ...state.preferences, ...patch }; broadcast(); },
      setOutcome: next => { outcome = next; },
      rejectPreparation: () => { rejectPreparation = true; },
      holdExecution: () => { holdExecution = true; },
      releaseExecution: () => { releaseExecution?.(); releaseExecution = undefined; },
    };
  });
  await page.goto(`${appUrl}?view=${view}`);
  await page.locator('#creature svg').waitFor();
  await page.mouse.move(1, 1);
  return page;
}

async function run(name, test, view = 'pet') {
  const page = await newPage(view);
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

async function drag(page, type, { target = 'body', x = 0.8, y = 0.25, files = true, relatedTarget } = {}) {
  await page.evaluate(({ type, target, x, y, files, relatedTarget }) => {
    const svg = document.querySelector('#creature svg');
    const bounds = svg.getBoundingClientRect();
    const transfer = new DataTransfer();
    if (files) transfer.items.add(new File(['test content'], 'synthetic.txt', { type: 'text/plain' }));
    else transfer.setData('text/plain', 'This is text, not a file.');
    const destination = target === 'document' ? document : document.querySelector(target);
    destination.dispatchEvent(new DragEvent(type, {
      bubbles: true, cancelable: true, dataTransfer: transfer,
      clientX: bounds.x + bounds.width * x, clientY: bounds.y + bounds.height * y,
      relatedTarget: relatedTarget ? document.querySelector(relatedTarget) : null,
    }));
  }, { type, target, x, y, files, relatedTarget });
  await page.clock.runFor(16);
}

async function look(page) {
  return page.locator('#creature').evaluate(creature => {
    const style = getComputedStyle(creature);
    const gaze = creature.querySelector('.pet-gaze');
    return {
      x: Number.parseFloat(style.getPropertyValue('--look-x')),
      y: Number.parseFloat(style.getPropertyValue('--look-y')),
      angle: Number.parseFloat(style.getPropertyValue('--aim-angle')),
      facing: Number.parseFloat(style.getPropertyValue('--turret-facing')),
      travel: Number.parseFloat(style.getPropertyValue('--tank-travel-y')),
      transform: gaze ? getComputedStyle(gaze).transform : undefined,
    };
  });
}

async function assertNoFileCalls(page) {
  assert.deepEqual(await page.evaluate(() => window.fileDragTest.snapshot().calls), { prepare: 0, execute: 0, choose: 0 },
    'Looking at or interacting with a pet must not call file APIs.');
  assert.deepEqual(await page.evaluate(() => window.fileDragTest.snapshot().state.stats), { files: 0, bytes: 0, meals: 0 });
}

try {
  for (const view of ['main', 'pet']) {
    await run(`${view}: ordinary pointer movement and text drags never move the pet gaze`, async page => {
      for (const theme of themes) {
        await page.evaluate(theme => window.fileDragTest.setPreferences({ theme }), theme);
        await page.mouse.move(40, 40);
        await page.mouse.move(400, 400);
        assert.notEqual(await page.locator('#drop-zone').getAttribute('data-looking'), 'true', `${theme} must ignore ordinary pointer movement.`);
        assert.notEqual(await page.locator('#drop-zone').getAttribute('data-tracking'), 'true');
        await drag(page, 'dragover', { target: '#creature', files: false });
        assert.notEqual(await page.locator('#drop-zone').getAttribute('data-looking'), 'true', 'Text drags must not activate gaze.');
      }
      await assertNoFileCalls(page);
    }, view);

    await run(`${view}: every pet looks toward files before they reach the drop target`, async page => {
      await page.evaluate(() => window.fileDragTest.setPreferences({ reduceMotion: true }));
      for (const theme of themes) {
        await page.evaluate(theme => window.fileDragTest.setPreferences({ theme }), theme);
        await drag(page, 'dragenter', { x: 0.15, y: 0.15 });
        await drag(page, 'dragover', { x: 0.15, y: 0.15 });
        assert.equal(await page.locator('#drop-zone').getAttribute('data-tracking'), 'true', `${theme} should notice file drags across the window.`);
        assert.notEqual(await page.locator('#drop-zone').getAttribute('data-phase'), 'hover', 'Tracking outside the target must not imply drop readiness.');
        const left = await look(page);
        assert.ok(left.x < 0 && left.y < 0, `${theme} should look up and left.`);
        await drag(page, 'dragover', { x: 0.85, y: 0.85 });
        const right = await look(page);
        assert.ok(right.x > 0 && right.y > 0, `${theme} should look down and right.`);
        assert.ok(left.transform && right.transform && left.transform !== right.transform, `${theme} must visibly move its gaze, not only update state.`);
        if (theme === 'blade') {
          assert.equal(left.facing, -1);
          assert.equal(right.facing, 1);
          assert.ok(Math.abs(left.angle) <= 12 && Math.abs(right.angle) <= 12, 'The turret must stay upright.');
          assert.ok(left.travel < 0 && right.travel > 0, 'The tank body should travel toward vertical targets.');
        }
        await drag(page, 'dragend', { target: 'document' });
        assert.notEqual(await page.locator('#drop-zone').getAttribute('data-tracking'), 'true');
      }
      await assertNoFileCalls(page);
    }, view);

    await run(`${view}: text drags never trigger file tracking or readiness`, async page => {
      await drag(page, 'dragenter', { target: '#drop-zone', files: false });
      await drag(page, 'dragover', { target: '#drop-zone', files: false });
      assert.notEqual(await page.locator('#drop-zone').getAttribute('data-tracking'), 'true');
      assert.equal(await page.locator('#drop-zone').getAttribute('data-phase'), 'idle');
      assert.notEqual((await page.locator('#speech').textContent()).trim(), 'stand by !');
      await drag(page, 'drop', { target: '#drop-zone', files: false });
      await assertNoFileCalls(page);
    }, view);

    await run(`${view}: tank readiness survives child transitions and clears when leaving the target`, async page => {
      await drag(page, 'dragenter', { target: '#drop-zone' });
      await drag(page, 'dragenter', { target: '#creature' });
      await drag(page, 'dragover', { target: '#creature' });
      assert.equal(await page.locator('#drop-zone').getAttribute('data-phase'), 'hover');
      await expect(page.locator('#speech')).toHaveText('stand by !');
      await expect(page.locator('#speech')).toBeVisible();
      await drag(page, 'dragleave', { target: '#creature', relatedTarget: '#drop-zone' });
      assert.equal(await page.locator('#drop-zone').getAttribute('data-phase'), 'hover', 'Moving between target children must not flicker the readiness state.');
      await drag(page, 'dragleave', { target: '#drop-zone', relatedTarget: 'body', x: 0.1 });
      assert.notEqual(await page.locator('#drop-zone').getAttribute('data-phase'), 'hover');
      assert.equal(await page.locator('#drop-zone').getAttribute('data-tracking'), 'true', 'The pet should keep looking while the file remains in its window.');
      assert.notEqual((await page.locator('#speech').textContent()).trim(), 'stand by !');
      if (view === 'pet') await expect(page.locator('#speech')).toBeHidden();
      await drag(page, 'dragleave', { target: 'document' });
      assert.notEqual(await page.locator('#drop-zone').getAttribute('data-tracking'), 'true', 'Leaving the document must stop file tracking.');
      await assertNoFileCalls(page);
    }, view);

    await run(`${view}: clicking the tank fires a short animation without touching files`, async page => {
      assert.equal(await page.locator('#creature .tank-turret').count(), 1, 'The old blade scene must be replaced by the tank.');
      await page.locator('#creature').click();
      assert.equal(await page.locator('#drop-zone').getAttribute('data-interacting'), 'true');
      const animation = await page.locator('#creature .tank-muzzle-flash').evaluate(node => getComputedStyle(node).animationName);
      assert.match(animation, /tank/, 'Tank click interaction must animate the muzzle flash.');
      assert.equal(await page.locator('#creature .tank-target .meal-file').evaluate(node => getComputedStyle(node).animationName), 'none',
        'Clicking without a file should fire without pretending to destroy a file.');
      if (view === 'pet') await expect(page.locator('.pet-reaction')).toBeHidden();
      await assertNoFileCalls(page);
      await page.clock.runFor(2000);
      assert.notEqual(await page.locator('#drop-zone').getAttribute('data-interacting'), 'true');
    }, view);
  }

  await run('tank stays upright below the pointer and resets its pose when file drag ends', async page => {
    await page.evaluate(() => window.fileDragTest.setPreferences({ reduceMotion: true }));
    await drag(page, 'dragover', { target: '#creature', x: 0.9, y: 0.2 });
    const above = await look(page);
    await drag(page, 'dragover', { target: '#creature', x: 0.9, y: 0.9 });
    const below = await look(page);
    assert.equal(above.angle, below.angle, 'Vertical movement must not rotate the turret.');
    assert.equal(above.facing, below.facing);
    assert.ok(above.travel < 0 && below.travel > 0);
    const matrix = await page.locator('.tank-turret').evaluate(node => {
      const transform = new DOMMatrix(getComputedStyle(node).transform);
      return { upright: transform.d };
    });
    assert.ok(matrix.upright > 0.9, 'The turret roof must remain above its pivot.');
    await drag(page, 'dragend', { target: 'document' });
    assert.notEqual(await page.locator('#drop-zone').getAttribute('data-looking'), 'true');
    assert.equal(await page.locator('#creature').evaluate(node => node.style.getPropertyValue('--tank-travel-y')), '');
    await page.mouse.move(400, 450);
    assert.notEqual(await page.locator('#drop-zone').getAttribute('data-looking'), 'true');
  });

  await run('dropping fires once, ignores new file drags while busy, and then clears tracking', async page => {
    await page.evaluate(() => window.fileDragTest.holdExecution());
    await drag(page, 'dragenter', { target: '#drop-zone', x: 0.1, y: 0.2 });
    await drag(page, 'drop', { target: '#drop-zone', x: 0.1, y: 0.2 });
    await expect.poll(() => page.evaluate(() => window.fileDragTest.snapshot().calls.execute)).toBe(1);
    assert.equal(await page.locator('#drop-zone').getAttribute('data-phase'), 'idle');
    assert.equal(await page.locator('#drop-zone').getAttribute('aria-busy'), 'true');
    assert.notEqual((await page.locator('#speech').textContent()).trim(), 'stand by !');
    assert.equal(await page.locator('#creature .tank-muzzle-flash').evaluate(node => getComputedStyle(node).animationName), 'none',
      'Waiting for confirmation or file execution must not imply that the file has already been destroyed.');
    const shot = await look(page);
    await drag(page, 'dragenter', { target: '#drop-zone', x: 0.9, y: 0.9 });
    await drag(page, 'dragover', { target: '#drop-zone', x: 0.9, y: 0.9 });
    assert.equal(await page.locator('#drop-zone').getAttribute('data-phase'), 'idle');
    assert.equal((await look(page)).angle, shot.angle, 'A new drag must not redirect an in-progress shot.');
    await drag(page, 'drop', { target: '#drop-zone' });
    assert.deepEqual(await page.evaluate(() => window.fileDragTest.snapshot().calls), { prepare: 1, execute: 1, choose: 0 });
    await page.evaluate(() => window.fileDragTest.releaseExecution());
    await expect.poll(() => page.locator('#drop-zone').getAttribute('data-phase')).toBe('processing');
    assert.match(await page.locator('#creature .tank-muzzle-flash').evaluate(node => getComputedStyle(node).animationName), /tank/);
    assert.notEqual(await page.locator('#creature .tank-target .meal-file').evaluate(node => getComputedStyle(node).animationName), 'none',
      'A successfully processed file should be animated as the shot target.');
    assert.notEqual(await page.locator('#creature .tank-target .scene-fragment').first().evaluate(node => getComputedStyle(node).animationName), 'none',
      'A successfully processed file should break into animated fragments.');
    await page.clock.runFor(2000);
    assert.equal(await page.locator('#drop-zone').getAttribute('data-phase'), 'success');
    assert.notEqual(await page.locator('#drop-zone').getAttribute('data-tracking'), 'true');
    assert.equal(await page.evaluate(() => window.fileDragTest.snapshot().state.stats.files), 1);
  });

  for (const outcome of ['rejected', 'cancelled', 'error']) {
    await run(`${outcome} files never produce a success state or a stuck readiness bubble`, async page => {
      await page.evaluate(outcome => {
        window.fileDragTest.setPreferences({ reduceMotion: true });
        if (outcome === 'rejected') window.fileDragTest.rejectPreparation();
        else window.fileDragTest.setOutcome(outcome);
        window.observedFileDragPhases = [];
        const zone = document.querySelector('#drop-zone');
        new MutationObserver(records => {
          window.observedFileDragPhases.push(...records.map(record => record.oldValue), zone.dataset.phase);
        }).observe(zone, { attributes: true, attributeFilter: ['data-phase'], attributeOldValue: true });
      }, outcome);
      await drag(page, 'dragenter', { target: '#drop-zone' });
      await drag(page, 'drop', { target: '#drop-zone' });
      await page.clock.runFor(250);
      assert.equal(await page.locator('#drop-zone').getAttribute('data-phase'), outcome === 'cancelled' ? 'idle' : 'error');
      assert.notEqual(await page.locator('#drop-zone').getAttribute('data-tracking'), 'true');
      assert.notEqual((await page.locator('#speech').textContent()).trim(), 'stand by !');
      await expect(page.locator('#speech')).toBeHidden();
      await expect(page.locator('#result-panel')).toBeVisible();
      assert.deepEqual(await page.evaluate(() => window.fileDragTest.snapshot().state.stats), { files: 0, bytes: 0, meals: 0 });
      assert.equal(await page.evaluate(() => window.fileDragTest.snapshot().calls.execute), outcome === 'rejected' ? 0 : 1);
      const observedPhases = await page.evaluate(() => window.observedFileDragPhases);
      assert.ok(!observedPhases.includes('processing') && !observedPhases.includes('success'),
        'Rejected, cancelled, and failed file operations must never briefly show a destructive shot or success.');
    });
  }

  for (const outcome of ['cancelled', 'error']) {
    await run(`theme broadcasts cannot turn a pending ${outcome} meal into a tank shot`, async page => {
      await page.evaluate(outcome => {
        window.fileDragTest.setPreferences({ theme: 'munch', reduceMotion: true });
        window.fileDragTest.setOutcome(outcome);
        window.fileDragTest.holdExecution();
        window.observedTankProcessing = false;
        const zone = document.querySelector('#drop-zone');
        new MutationObserver(() => {
          if (zone.dataset.phase === 'processing' && zone.querySelector('.tank-turret')) window.observedTankProcessing = true;
        }).observe(zone, { childList: true, subtree: true, attributes: true, attributeFilter: ['data-phase'] });
      }, outcome);
      await drag(page, 'dragenter', { target: '#drop-zone' });
      await drag(page, 'drop', { target: '#drop-zone' });
      await expect.poll(() => page.evaluate(() => window.fileDragTest.snapshot().calls.execute)).toBe(1);
      assert.equal(await page.locator('#drop-zone').getAttribute('data-phase'), 'processing');
      await page.evaluate(() => window.fileDragTest.setPreferences({ theme: 'blade' }));
      assert.equal(await page.locator('#creature .creature-scene').getAttribute('data-theme'), 'munch',
        'An in-flight meal should retain the scene that started it while preserving newer preferences.');
      assert.equal(await page.locator('#creature .tank-turret').count(), 0, 'A pending non-tank operation must not acquire a cannon animation.');
      await page.evaluate(() => window.fileDragTest.releaseExecution());
      await page.clock.runFor(250);
      assert.equal(await page.locator('#creature .creature-scene').getAttribute('data-theme'), 'blade', 'The newest theme should render once processing finishes.');
      assert.equal(await page.locator('#drop-zone').getAttribute('data-phase'), outcome === 'cancelled' ? 'idle' : 'error');
      assert.equal(await page.locator('#creature .tank-muzzle-flash').evaluate(node => getComputedStyle(node).animationName), 'none');
      assert.equal(await page.evaluate(() => window.observedTankProcessing), false, 'A cancelled or failed operation must never display a tank processing state.');
      assert.equal(await page.evaluate(() => window.fileDragTest.snapshot().state.preferences.theme), 'blade');
      assert.deepEqual(await page.evaluate(() => window.fileDragTest.snapshot().state.stats), { files: 0, bytes: 0, meals: 0 });
    });
  }

  await run('a successful tank shot keeps its scene until completion then applies the latest theme', async page => {
    await page.evaluate(() => window.fileDragTest.holdExecution());
    await drag(page, 'dragenter', { target: '#drop-zone' });
    await drag(page, 'drop', { target: '#drop-zone' });
    await expect.poll(() => page.evaluate(() => window.fileDragTest.snapshot().calls.execute)).toBe(1);
    await page.evaluate(() => window.fileDragTest.setPreferences({ theme: 'munch' }));
    assert.equal(await page.locator('#creature .creature-scene').getAttribute('data-theme'), 'blade', 'A pending tank operation should retain its selected cannon scene.');
    assert.equal(await page.locator('#drop-zone').getAttribute('data-phase'), 'idle');
    await page.evaluate(() => window.fileDragTest.releaseExecution());
    await expect.poll(() => page.locator('#drop-zone').getAttribute('data-phase')).toBe('processing');
    assert.equal(await page.locator('#creature .creature-scene').getAttribute('data-theme'), 'blade', 'The confirmed shot must remain a tank animation.');
    assert.match(await page.locator('#creature .tank-muzzle-flash').evaluate(node => getComputedStyle(node).animationName), /tank/);
    await page.clock.runFor(2000);
    assert.equal(await page.locator('#drop-zone').getAttribute('aria-busy'), 'false');
    assert.equal(await page.locator('#creature .creature-scene').getAttribute('data-theme'), 'munch');
    assert.equal(await page.evaluate(() => window.fileDragTest.snapshot().state.preferences.theme), 'munch', 'Finishing an earlier operation must not revert newer preferences.');
    assert.equal(await page.evaluate(() => window.fileDragTest.snapshot().state.stats.files), 1);
  });

  await run('dropping outside the target cancels tracking without preparing files', async page => {
    await drag(page, 'dragenter', { target: '#drop-zone' });
    await drag(page, 'drop', { target: 'body' });
    assert.notEqual(await page.locator('#drop-zone').getAttribute('data-tracking'), 'true');
    assert.equal(await page.locator('#drop-zone').getAttribute('data-phase'), 'idle');
    await expect(page.locator('#speech')).toBeHidden();
    await assertNoFileCalls(page);
  });

  for (const source of ['preference', 'system']) {
    await run(`${source} reduced motion preserves targeting and readiness with no firing animation`, async page => {
      if (source === 'preference') await page.evaluate(() => window.fileDragTest.setPreferences({ reduceMotion: true }));
      else await page.emulateMedia({ reducedMotion: 'reduce' });
      await drag(page, 'dragenter', { target: '#drop-zone', x: 0.9 });
      await expect(page.locator('#speech')).toHaveText('stand by !');
      assert.equal(await page.locator('#drop-zone').getAttribute('data-tracking'), 'true');
      assert.ok((await look(page)).x > 0);
      await drag(page, 'dragend', { target: 'document' });
      await page.locator('#creature').click();
      assert.equal(await page.locator('#creature .tank-muzzle-flash').evaluate(node => getComputedStyle(node).animationName), 'none');
      await assertNoFileCalls(page);
      await drag(page, 'drop', { target: '#drop-zone' });
      await page.clock.runFor(300);
      assert.equal(await page.locator('#drop-zone').getAttribute('data-phase'), 'success', 'Reduced motion should retain prompt processing feedback.');
    });
  }
} finally {
  await browser.close();
}

if (failures.length) throw new Error(`${failures.length} file drag regression(s) failed: ${failures.join('; ')}`);
console.log('File drag regressions passed; only synthetic files and mocked desktop IPC were used.');
