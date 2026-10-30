import assert from 'node:assert/strict';
import test from 'node:test';
import { getPetWindowSize, PET_SIZE_DEFAULT, PET_SIZE_MAX, PET_SIZE_MIN } from '../src/shared/pet-layout';

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
