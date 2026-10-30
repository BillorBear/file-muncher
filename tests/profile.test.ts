import assert from 'node:assert/strict';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import test from 'node:test';
import { getProfilePath } from '../src/main/profile';

test('the renamed application retains the original profile directory', () => {
  const appData = join(tmpdir(), 'application-data');
  assert.equal(getProfilePath(appData), join(appData, '文件粉碎机'));
  assert.equal(getProfilePath(appData, ''), join(appData, '文件粉碎机'));
});

test('an explicit absolute profile remains isolated and relative overrides are rejected', () => {
  const appData = join(tmpdir(), 'application-data');
  const override = join(tmpdir(), 'isolated-profile');
  assert.equal(getProfilePath(appData, override), override);
  assert.throws(() => getProfilePath(appData, './relative-profile'), /absolute path/);
});
