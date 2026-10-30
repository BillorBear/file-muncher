import assert from 'node:assert/strict';
import test from 'node:test';
import { calculatePetGaze } from '../src/shared/pet-gaze';

test('the turret and gaze follow files in all four directions', () => {
  assert.equal(calculatePetGaze({ x: 310, y: 184 }, 0).angle, 0);
  assert.equal(calculatePetGaze({ x: 210, y: 84 }, 0).angle, -90);
  assert.equal(Math.abs(calculatePetGaze({ x: 110, y: 184 }, 0).angle), 180);
  assert.equal(calculatePetGaze({ x: 210, y: 284 }, 0).angle, 90);
  assert.ok(calculatePetGaze({ x: 110, y: 84 }, 0).x < 0);
  assert.ok(calculatePetGaze({ x: 310, y: 284 }, 0).y > 0);
});

test('crossing behind the turret takes the short rotation instead of spinning around', () => {
  const gaze = calculatePetGaze({ x: 110, y: 182 }, 179);
  assert.ok(gaze.angle > 180 && gaze.angle < 183);
});

test('far away files keep eyes within the face and a file on the pivot preserves aim', () => {
  const far = calculatePetGaze({ x: -10000, y: 10000 }, 0);
  assert.ok(Math.abs(far.x) <= 8 && Math.abs(far.y) <= 6);
  assert.ok(Math.abs(far.tilt) <= 5);
  assert.equal(calculatePetGaze({ x: 210, y: 184 }, 37).angle, 37);
  assert.equal(calculatePetGaze({ x: 210, y: 184 }, 37).x, 0);
});
