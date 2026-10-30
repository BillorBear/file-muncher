import assert from 'node:assert/strict';
import test from 'node:test';
import { deriveGrowth } from '../src/shared/growth';

test('successful meals grow weight and size from an empty pet', () => {
  const initial = deriveGrowth({ files: 0, bytes: 0, meals: 0 });
  const fed = deriveGrowth({ files: 30, bytes: 1024 ** 3, meals: 4 });
  assert.ok(fed.weightKg > initial.weightKg);
  assert.ok(fed.scale > initial.scale);
  assert.ok(fed.level > initial.level);
});

test('even huge lifetime totals cannot make the desktop pet exceed its size limit', () => {
  const grown = deriveGrowth({ files: Number.MAX_SAFE_INTEGER, bytes: Number.MAX_SAFE_INTEGER, meals: 100 });
  assert.equal(grown.scale, 1.3);
  assert.equal(grown.level, 5);
  assert.equal(grown.progress, 1);
  assert.ok(Number.isFinite(grown.weightKg));
});
