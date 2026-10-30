export interface PetGaze {
  angle: number;
  x: number;
  y: number;
  tilt: number;
}

export function calculatePetGaze(point: { x: number; y: number }, previousAngle: number): PetGaze {
  const x = point.x - 210;
  const y = point.y - 184;
  const distance = Math.hypot(x, y);
  const direction = Math.atan2(y, x) * 180 / Math.PI;
  const turn = ((direction - previousAngle) % 360 + 540) % 360 - 180;
  const reach = Math.max(80, distance);
  return {
    angle: distance < 3 ? previousAngle : previousAngle + turn,
    x: x / reach * 8,
    y: y / reach * 6,
    tilt: x / reach * 5,
  };
}
