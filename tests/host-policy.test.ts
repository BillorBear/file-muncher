import assert from 'node:assert/strict';
import test from 'node:test';
import {
  BatchOwnership,
  clampBounds,
  getPetSettingsBounds,
  parsePreferencePatch,
  PetDragSession,
  PendingPreferenceWrites,
  permanentDeletionDetail,
} from '../src/main/host-policy';

test('IPC preferences accept only typed supported options', () => {
  assert.deepEqual(parsePreferencePatch({ theme: 'pixel', petVisible: false }), {
    theme: 'pixel', petVisible: false,
  });
  for (const value of [null, [], 'pixel', { theme: 'unknown' }, { petVisible: 'false' },
    { deletionMode: 'erase' }, { filePath: '/Users/example' }, { reduceMotion: 1 }]) {
    assert.throws(() => parsePreferencePatch(value));
  }
});

test('IPC pet sizes allow the supported range and reject malformed or unbounded values', () => {
  for (const petSize of [0.5, 0.7, 1]) {
    assert.deepEqual(parsePreferencePatch({ petSize }), { petSize });
  }
  for (const petSize of [0.49, 1.01, NaN, Infinity, '0.7', null]) {
    assert.throws(() => parsePreferencePatch({ petSize }));
  }
});

test('pet stays inside a monitor with negative coordinates and a dock inset', () => {
  const workArea = { x: -1920, y: 28, width: 1920, height: 1012 };
  assert.deepEqual(clampBounds({ x: -2100, y: 900, width: 300, height: 340 }, workArea), {
    x: -1920, y: 700, width: 300, height: 340,
  });
  assert.deepEqual(clampBounds({ x: 1, y: 1, width: 300, height: 340 }, workArea), {
    x: -300, y: 28, width: 300, height: 340,
  });
});

test('settings stay close to the current visible body instead of reserving maximum-size space', () => {
  const area = { x: 0, y: 25, width: 1440, height: 875 };
  const settings = getPetSettingsBounds({ x: 300, y: 100, width: 150, height: 194 }, area, 'blade', 1);
  assert.ok(settings.x >= 425 && settings.x <= 429, 'The panel should be about 12px from the small tank.');
  assert.ok(settings.y >= 205 && settings.y <= 208, 'The panel should align with the tank body, below its speech.');
});

test('settings open to the left near the right edge without reserving future growth', () => {
  const area = { x: -1440, y: 25, width: 1440, height: 875 };
  const settings = getPetSettingsBounds({ x: -234, y: 634, width: 210, height: 242 }, area, 'blade', 1.3);
  assert.ok(settings.x >= -510 && settings.x <= -470);
  assert.ok(settings.y + settings.height <= area.y + area.height);
});

test('settings use vertical space when there is no horizontal room', () => {
  const area = { x: 0, y: 0, width: 360, height: 1000 };
  const settings = getPetSettingsBounds({ x: 75, y: 400, width: 210, height: 242 }, area, 'blade', 1);
  assert.ok(settings.y >= 621 && settings.y <= 625, 'The panel should fit below the body.');
  assert.ok(settings.x >= area.x && settings.x + settings.width <= area.x + area.width);
});

test('settings remain within the work area on a compact display', () => {
  const area = { x: 20, y: 30, width: 500, height: 400 };
  const settings = getPetSettingsBounds({ x: 240, y: 120, width: 210, height: 242 }, area);
  assert.ok(settings.x >= area.x && settings.y >= area.y);
  assert.ok(settings.x + settings.width <= area.x + area.width);
  assert.ok(settings.y + settings.height <= area.y + area.height);
});

test('settings remain close to the body at the bottom screen edge', () => {
  const area = { x: 0, y: 25, width: 1920, height: 1055 };
  const settings = getPetSettingsBounds({ x: 1686, y: 814, width: 210, height: 242 }, area, 'munch', 1);
  assert.ok(settings.x >= 1458 && settings.x <= 1462,
    'Speech avoidance must not push the card away to the transparent window boundary.');
  assert.ok(settings.y + settings.height <= area.y + area.height);
});

test('pet dragging follows the system cursor offset and clamps to the selected display', () => {
  const drag = new PetDragSession();
  const area = { x: -1920, y: 28, width: 1920, height: 1012 };
  const bounds = { x: -500, y: 300, width: 210, height: 270 };
  const cursor = { x: -420, y: 380 };
  drag.begin(bounds, cursor);
  bounds.x = 20;
  cursor.x = 10;
  assert.deepEqual(drag.move({ x: -320, y: 480 }, area), { x: -400, y: 400, width: 210, height: 270 });
  assert.deepEqual(drag.move({ x: 200, y: 1100 }, area), { x: -210, y: 770, width: 210, height: 270 });
});

test('pet movement ends with its drag session and can start again from a new origin', () => {
  const drag = new PetDragSession();
  const area = { x: 0, y: 0, width: 1440, height: 900 };
  assert.equal(drag.move({ x: 500, y: 400 }, area), null);
  drag.begin({ x: 100, y: 100, width: 210, height: 270 }, { x: 150, y: 150 });
  drag.end();
  assert.equal(drag.move({ x: 500, y: 400 }, area), null);
  drag.begin({ x: 200, y: 200, width: 150, height: 222 }, { x: 250, y: 250 });
  assert.deepEqual(drag.move({ x: 270, y: 280 }, area), { x: 220, y: 230, width: 150, height: 222 });
});

test('a deletion batch belongs to one window and cannot execute twice concurrently', () => {
  const batches = new BatchOwnership();
  batches.add('batch-one', 7);
  assert.throws(() => batches.begin('batch-one', 8));
  batches.begin('batch-one', 7);
  assert.throws(() => batches.begin('batch-one', 7));
  batches.finish('batch-one');
  assert.throws(() => batches.begin('batch-one', 7));
});

test('closing a window revokes its prepared batches without affecting another window', () => {
  const batches = new BatchOwnership();
  batches.add('first', 7);
  batches.add('second', 8);
  assert.deepEqual(batches.removeOwner(7), ['first']);
  assert.throws(() => batches.begin('first', 7));
  batches.begin('second', 8);
});

test('permanent confirmation says irreversible and escapes filename line breaks', () => {
  const detail = permanentDeletionDetail({ token: 'token', mode: 'permanent', rejected: [], entries: [
    { id: '1', name: 'report\nCancel.txt', kind: 'file', fileCount: 1, bytes: 40 },
    { id: '2', name: 'photos', kind: 'directory', fileCount: 3, bytes: 10 },
  ] });
  assert.match(detail, /无法从回收站恢复/);
  assert.match(detail, /4 个文件/);
  assert.match(detail, /report Cancel.txt/);
  assert.doesNotMatch(detail, /report\nCancel/);
});

test('overlapping preparations are rejected per window until the current preparation ends', () => {
  const batches = new BatchOwnership();
  batches.beginPreparation(7);
  assert.throws(() => batches.beginPreparation(7));
  batches.beginPreparation(8);
  batches.finishPreparation(7);
  batches.beginPreparation(7);
  batches.finishPreparation(7);
  batches.finishPreparation(8);
});

test('quit waits for started preference writes and prevents new writes from extending the wait', () => {
  const writes = new PendingPreferenceWrites();
  writes.begin();
  writes.begin();
  writes.close();
  assert.equal(writes.hasPending, true);
  assert.throws(() => writes.begin());
  writes.finish();
  assert.equal(writes.hasPending, true);
  writes.finish();
  assert.equal(writes.hasPending, false);
  assert.throws(() => writes.begin());
});
