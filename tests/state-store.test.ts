import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test, { type TestContext } from 'node:test';
import { StateStore } from '../src/main/state-store';
import type { BatchItemResult, Preferences } from '../src/shared/types';

async function fixture(t: TestContext) {
  const root = await mkdtemp(join(tmpdir(), 'munch-state-test-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const path = join(root, 'state.json');
  return { root, path, store: new StateStore(path) };
}

const SUCCESS: BatchItemResult = { name: 'a', status: 'success', fileCount: 3, bytes: 25 };

test('starts with safe defaults when no state file exists', async (t) => {
  const { store } = await fixture(t);
  const state = await store.load();
  assert.equal(state.preferences.deletionMode, 'trash');
  assert.equal(state.preferences.petVisible, true);
  assert.equal(state.preferences.petSize, 0.7);
  assert.deepEqual(state.stats, { files: 0, bytes: 0, meals: 0 });
});

test('loads legacy preferences with a smaller pet without losing settings or statistics', async (t) => {
  const { path, store } = await fixture(t);
  const preferences = { theme: 'pixel', deletionMode: 'permanent', petVisible: false, reduceMotion: true };
  const stats = { files: 27, bytes: 2084, meals: 12 };
  await writeFile(path, JSON.stringify({ version: 1, preferences, stats }));
  assert.deepEqual(await store.load(), { preferences: { ...preferences, petSize: 0.7 }, stats });
  await store.updatePreferences({ petSize: 0.5 });
  assert.deepEqual(await new StateStore(path).load(), { preferences: { ...preferences, petSize: 0.5 }, stats });
});

test('rejects invalid pet sizes without changing the saved state', async (t) => {
  const { store } = await fixture(t);
  for (const petSize of [0.49, 1.01, NaN, Infinity, '0.7', null]) {
    await assert.rejects(store.updatePreferences({ petSize } as unknown as Partial<Preferences>));
  }
  assert.equal(store.getState().preferences.petSize, 0.7);
});

test('legacy migration rejects unknown preference keys instead of discarding them', async (t) => {
  const { path, store } = await fixture(t);
  await writeFile(path, JSON.stringify({ version: 1,
    preferences: { theme: 'munch', deletionMode: 'trash', petVisible: true, unknown: false },
    stats: { files: 0, bytes: 0, meals: 0 } }));
  await assert.rejects(store.load());
});

test('persists preferences and only successful deletion counts across reloads', async (t) => {
  const { store, path } = await fixture(t);
  await store.load();
  await store.updatePreferences({ theme: 'pixel', deletionMode: 'permanent' });
  await store.recordResults([SUCCESS, { name: 'b', status: 'error', fileCount: 99, bytes: 99 }]);
  const reloaded = await new StateStore(path).load();
  assert.equal(reloaded.preferences.theme, 'pixel');
  assert.equal(reloaded.preferences.deletionMode, 'permanent');
  assert.deepEqual(reloaded.stats, { files: 3, bytes: 25, meals: 1 });
});

test('counts empty directories as successful meals but not as files', async (t) => {
  const { store } = await fixture(t);
  await store.recordResults([{ name: 'empty', status: 'success', fileCount: 0, bytes: 0 }]);
  await store.recordResults([{ name: 'bad', status: 'error', fileCount: 0, bytes: 0 }]);
  assert.deepEqual(store.getState().stats, { files: 0, bytes: 0, meals: 1 });
});

test('rejects corrupted disk state without trusting its counts or preferences', async (t) => {
  const { path, store } = await fixture(t);
  await writeFile(path, JSON.stringify({ version: 1, preferences: { theme: 'unknown', deletionMode: 'permanent', petVisible: true, reduceMotion: false }, stats: { files: -2, bytes: 3, meals: 1 } }));
  await assert.rejects(store.load());
  assert.equal(store.getState().preferences.deletionMode, 'trash');
  assert.deepEqual(store.getState().stats, { files: 0, bytes: 0, meals: 0 });
});

test('rejects malformed or unknown preference fields', async (t) => {
  const { store } = await fixture(t);
  await assert.rejects(store.updatePreferences({ deletionMode: 'destroy' } as unknown as Partial<Preferences>));
  await assert.rejects(store.updatePreferences({ hidden: true } as unknown as Partial<Preferences>));
  assert.equal(store.getState().preferences.deletionMode, 'trash');
});

test('defensively copies returned state', async (t) => {
  const { store } = await fixture(t);
  const state = store.getState();
  state.stats.files = 500;
  state.preferences.deletionMode = 'permanent';
  assert.equal(store.getState().stats.files, 0);
  assert.equal(store.getState().preferences.deletionMode, 'trash');
});

test('serializes concurrent updates without losing counts or preferences', async (t) => {
  const { store, path } = await fixture(t);
  await Promise.all([
    store.recordResults([SUCCESS]),
    store.updatePreferences({ theme: 'blade' }),
    store.recordResults([SUCCESS]),
    store.updatePreferences({ reduceMotion: true }),
  ]);
  const state = await new StateStore(path).load();
  assert.deepEqual(state.stats, { files: 6, bytes: 50, meals: 2 });
  assert.equal(state.preferences.theme, 'blade');
  assert.equal(state.preferences.reduceMotion, true);
  assert.equal(JSON.parse(await readFile(path, 'utf8')).version, 1);
});

test('surfaces persistence errors while keeping successful counts in memory', async (t) => {
  const { path, store } = await fixture(t);
  await mkdir(path);
  await assert.rejects(store.recordResults([SUCCESS]));
  assert.deepEqual(store.getState().stats, { files: 3, bytes: 25, meals: 1 });
});

test('recovers the persistence queue after a failed write', async (t) => {
  const { path, store } = await fixture(t);
  await mkdir(path);
  await assert.rejects(store.recordResults([SUCCESS]));
  await rm(path, { recursive: true });
  await store.recordResults([SUCCESS]);
  assert.deepEqual((await new StateStore(path).load()).stats, { files: 6, bytes: 50, meals: 2 });
});

test('rejects unsafe numeric statistics without changing current state', async (t) => {
  const { store } = await fixture(t);
  await assert.rejects(store.recordResults([{ ...SUCCESS, bytes: Number.MAX_SAFE_INTEGER + 1 }]));
  await assert.rejects(store.recordResults([{ ...SUCCESS, fileCount: -1 }]));
  assert.deepEqual(store.getState().stats, { files: 0, bytes: 0, meals: 0 });
});

test('rejects malformed JSON and oversize state files', async (t) => {
  const { path, store } = await fixture(t);
  await writeFile(path, 'not json');
  await assert.rejects(store.load());
  await writeFile(path, ' '.repeat(16_385));
  await assert.rejects(store.load());
  assert.equal(store.getState().preferences.deletionMode, 'trash');
});
