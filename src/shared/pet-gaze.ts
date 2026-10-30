export interface PetGaze {
  angle: number;
  turretFacing: -1 | 1;
  tankTravelY: number;
  x: number;
  y: number;
  tilt: number;
}

const TURRET_CENTER_DEADZONE = 3;
const TURRET_MAX_TILT = 12;
const TANK_MAX_TRAVEL = 10;
const TANK_TARGET_REACH = 100;

export function calculatePetGaze(point: { x: number; y: number }, previousFacing: -1 | 1 = 1): PetGaze {
  const x = point.x - 210;
  const y = point.y - 184;
  const distance = Math.hypot(x, y);
  const reach = Math.max(80, distance);
  return {
    angle: -Math.min(Math.abs(x) / TANK_TARGET_REACH, 1) * TURRET_MAX_TILT,
    turretFacing: Math.abs(x) <= TURRET_CENTER_DEADZONE ? previousFacing : x < 0 ? -1 : 1,
    tankTravelY: Math.max(-1, Math.min(y / TANK_TARGET_REACH, 1)) * TANK_MAX_TRAVEL,
    x: x / reach * 8,
    y: y / reach * 6,
    tilt: x / reach * 5,
  };
}
