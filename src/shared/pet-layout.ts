import type { ThemeId } from './types';

export const PET_SIZE_MIN = 0.5;
export const PET_SIZE_MAX = 1;
export const PET_SIZE_DEFAULT = 0.7;

const PET_BASE_WIDTH = 300;
const PET_BODY_HEIGHT = 243;
const PET_SPEECH_SPACE = 72;
const PET_SCENE_TOP = 66;
const SVG_WIDTH = 420;
const SVG_HEIGHT = 340;
const GROWTH_ORIGIN_Y = 0.73;

export interface PetWindowSize {
  width: number;
  height: number;
}

export interface PetBodyBounds extends PetWindowSize {
  x: number;
  y: number;
}

// Body outlines in the shared SVG viewBox, including tank travel but excluding meal effects and decorations.
const BODY_BOUNDS: Readonly<Record<ThemeId, PetBodyBounds>> = {
  munch: { x: 92, y: 90, width: 236, height: 199 },
  pixel: { x: 96, y: 75, width: 228, height: 213 },
  blade: { x: 98, y: 111, width: 224, height: 178 },
  void: { x: 85, y: 101, width: 250, height: 147 },
  paper: { x: 120, y: 128, width: 211, height: 154 },
};

export function getPetBodyBounds(windowWidth: number, theme: ThemeId, growthScale: number): PetBodyBounds {
  const body = BODY_BOUNDS[theme];
  const svgScale = windowWidth / SVG_WIDTH;
  const sceneHeight = windowWidth * PET_BODY_HEIGHT / PET_BASE_WIDTH;
  const svgOffsetY = (sceneHeight - SVG_HEIGHT * svgScale) / 2;
  const originY = sceneHeight * GROWTH_ORIGIN_Y;
  return {
    x: windowWidth / 2 + (body.x * svgScale - windowWidth / 2) * growthScale,
    y: PET_SCENE_TOP + originY + (svgOffsetY + body.y * svgScale - originY) * growthScale,
    width: body.width * svgScale * growthScale,
    height: body.height * svgScale * growthScale,
  };
}

export function isPetSize(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= PET_SIZE_MIN && value <= PET_SIZE_MAX;
}

export function getPetWindowSize(size: number): PetWindowSize {
  const bounded = Number.isFinite(size) ? Math.min(PET_SIZE_MAX, Math.max(PET_SIZE_MIN, size)) : PET_SIZE_DEFAULT;
  return { width: Math.round(PET_BASE_WIDTH * bounded), height: Math.round(PET_BODY_HEIGHT * bounded + PET_SPEECH_SPACE) };
}
