import type { PetStats } from './types';

export interface PetGrowth {
  weightKg: number;
  scale: number;
  level: number;
  label: string;
  progress: number;
}

const MAX_SCALE = 1.3;
const LEVEL_STEP = 4;
const LABELS = ['小小胃口', '渐入佳境', '胃口大开', '快乐大胃王', '满级吞吞兽'] as const;

export function deriveGrowth(stats: PetStats): PetGrowth {
  const experience = Math.log2(1 + stats.files) + Math.log2(1 + stats.bytes / 1024 ** 2) * 0.6;
  const level = Math.min(LABELS.length, Math.floor(experience / LEVEL_STEP) + 1);
  return {
    weightKg: Math.round((1.2 + experience * 0.18) * 10) / 10,
    scale: Math.min(MAX_SCALE, 1 + experience * 0.012),
    level,
    label: LABELS[level - 1]!,
    progress: level === LABELS.length ? 1 : (experience % LEVEL_STEP) / LEVEL_STEP
  };
}
