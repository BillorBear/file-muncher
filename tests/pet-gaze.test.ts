import assert from 'node:assert/strict';
import test from 'node:test';
import { calculatePetGaze } from '../src/shared/pet-gaze';

test('the turret faces left and right while staying upright in every quadrant', () => {
  for (const x of [110, 310]) {
    for (const y of [84, 184, 284]) {
      const gaze = calculatePetGaze({ x, y });
      const angle = gaze.angle * Math.PI / 180;
      assert.equal(gaze.turretFacing, x < 210 ? -1 : 1);
      assert.ok(Math.abs(gaze.angle) <= 12);
      assert.ok(Math.cos(angle) > 0, 'the turret roof must stay above its pivot');
      assert.equal(Math.sign(Math.cos(angle) * gaze.turretFacing), Math.sign(x - 210));
    }
  }
});

test('vertical targets move the whole tank instead of turning the turret upside down', () => {
  const above = calculatePetGaze({ x: 310, y: 84 });
  const below = calculatePetGaze({ x: 310, y: 284 });
  assert.equal(above.angle, below.angle);
  assert.equal(above.turretFacing, below.turretFacing);
  assert.ok(above.tankTravelY < 0);
  assert.ok(below.tankTravelY > 0);
  assert.equal(calculatePetGaze({ x: 210, y: 184 }).tankTravelY, 0);
});

test('crossing the turret center keeps its last facing until the target passes the center deadzone', () => {
  assert.equal(calculatePetGaze({ x: 211, y: 284 }, -1).turretFacing, -1);
  assert.equal(calculatePetGaze({ x: 209, y: 84 }, 1).turretFacing, 1);
  assert.equal(calculatePetGaze({ x: 220, y: 284 }, -1).turretFacing, 1);
  assert.equal(calculatePetGaze({ x: 200, y: 84 }, 1).turretFacing, -1);
});

test('far away files keep eyes within the face and tank travel within its scene', () => {
  const far = calculatePetGaze({ x: -10000, y: 10000 });
  assert.ok(Math.abs(far.x) <= 8 && Math.abs(far.y) <= 6);
  assert.ok(Math.abs(far.tilt) <= 5);
  assert.equal(far.tankTravelY, 10);
  assert.equal(calculatePetGaze({ x: 10000, y: -10000 }).tankTravelY, -10);
  assert.equal(calculatePetGaze({ x: 210, y: 184 }).x, 0);
  assert.ok(calculatePetGaze({ x: 110, y: 84 }).x < 0);
  assert.ok(calculatePetGaze({ x: 310, y: 284 }).y > 0);
});
