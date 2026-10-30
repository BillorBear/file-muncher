export const PET_SIZE_MIN = 0.5;
export const PET_SIZE_MAX = 1;
export const PET_SIZE_DEFAULT = 0.7;

const PET_BASE_WIDTH = 300;
const PET_BODY_HEIGHT = 243;
const PET_SPEECH_SPACE = 72;

export interface PetWindowSize {
  width: number;
  height: number;
}

export function isPetSize(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= PET_SIZE_MIN && value <= PET_SIZE_MAX;
}

export function getPetWindowSize(size: number): PetWindowSize {
  const bounded = Number.isFinite(size) ? Math.min(PET_SIZE_MAX, Math.max(PET_SIZE_MIN, size)) : PET_SIZE_DEFAULT;
  return { width: Math.round(PET_BASE_WIDTH * bounded), height: Math.round(PET_BODY_HEIGHT * bounded + PET_SPEECH_SPACE) };
}
