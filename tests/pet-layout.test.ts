import assert from 'node:assert/strict';
import test from 'node:test';
import { getPetBodyBounds, getPetWindowSize, PET_SIZE_DEFAULT, PET_SIZE_MAX, PET_SIZE_MIN } from '../src/shared/pet-layout';
import type { ThemeId } from '../src/shared/types';

test('pet sizes reserve space above the body for transient speech', () => {
  assert.deepEqual(getPetWindowSize(PET_SIZE_MIN), { width: 150, height: 194 });
  assert.deepEqual(getPetWindowSize(PET_SIZE_DEFAULT), { width: 210, height: 242 });
  assert.deepEqual(getPetWindowSize(PET_SIZE_MAX), { width: 300, height: 315 });
});

test('window sizing bounds out of range values and falls back safely for non-finite values', () => {
  assert.deepEqual(getPetWindowSize(0), getPetWindowSize(PET_SIZE_MIN));
  assert.deepEqual(getPetWindowSize(100), getPetWindowSize(PET_SIZE_MAX));
  assert.deepEqual(getPetWindowSize(NaN), getPetWindowSize(PET_SIZE_DEFAULT));
  assert.deepEqual(getPetWindowSize(Infinity), getPetWindowSize(PET_SIZE_DEFAULT));
});

test('all pet body outlines and three-line speech fit at supported sizes and maximum growth', () => {
  const themes: readonly ThemeId[] = ['munch', 'pixel', 'blade', 'void', 'paper'];
  for (const theme of themes) {
    for (const size of [PET_SIZE_MIN, PET_SIZE_DEFAULT, PET_SIZE_MAX]) {
      for (const growth of [1, 1.3]) {
        const window = getPetWindowSize(size);
        const body = getPetBodyBounds(window.width, theme, growth);
        assert.ok(body.x >= 0 && body.x + body.width <= window.width, `${theme} body must fit horizontally.`);
        assert.ok(body.y + body.height <= window.height, `${theme} body must fit vertically.`);
        assert.ok(body.y >= 71, `${theme} needs space for three-line speech, padding and the 10px gap.`);
      }
    }
  }
});

test('speech and panel anchors follow growth toward the body instead of staying at the window edge', () => {
  const small = getPetBodyBounds(150, 'blade', 1);
  const grown = getPetBodyBounds(150, 'blade', 1.3);
  assert.ok(small.y > 105 && small.y < 106);
  assert.ok(grown.y < small.y);
  assert.ok(grown.x < small.x);
  assert.ok(grown.width > small.width);
  assert.ok(grown.y + grown.height > small.y + small.height);
});

test('tank anchors leave clearance for its vertical travel and mirrored barrel', () => {
  const body = getPetBodyBounds(210, 'blade', 1);
  assert.ok(body.y <= 122, 'The antenna must not reach the speech pointer when the tank moves forward.');
  assert.ok(body.y + body.height >= 210, 'The moving tracks must not reach the settings panel below.');
  assert.ok(body.x <= 50 && body.x + body.width >= 160, 'The barrel should fit when facing either side.');
});
