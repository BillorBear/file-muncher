import type { Preferences, PreparedBatch, ThemeId } from '../shared/types';
import { getPetBodyBounds, isPetSize } from '../shared/pet-layout';

export interface WindowBounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

const THEMES = new Set(['munch', 'pixel', 'blade', 'void', 'paper']);
const PET_SETTINGS_WIDTH = 260;
const PET_SETTINGS_HEIGHT = 180;
const PET_SETTINGS_GAP = 12;

export const CHANNELS = {
  state: 'shredder:state',
  prepare: 'shredder:prepare',
  choose: 'shredder:choose',
  execute: 'shredder:execute',
  preferences: 'shredder:preferences',
  stateChanged: 'shredder:state-changed',
  openMain: 'shredder:open-main',
  openPetSettings: 'shredder:open-pet-settings',
  closePetSettings: 'shredder:close-pet-settings',
  petSettingsDismissRequested: 'shredder:pet-settings-dismiss-requested',
  dismissPetSettings: 'shredder:dismiss-pet-settings',
  beginPetDrag: 'shredder:begin-pet-drag',
  movePetDrag: 'shredder:move-pet-drag',
  endPetDrag: 'shredder:end-pet-drag',
  quit: 'shredder:quit',
} as const;

export function parsePreferencePatch(value: unknown): Partial<Preferences> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error('设置格式无效。');
  }
  const patch: Partial<Preferences> = {};
  for (const [key, item] of Object.entries(value)) {
    switch (key) {
      case 'theme':
        if (typeof item !== 'string' || !THEMES.has(item)) throw new Error('未知的粉碎机造型。');
        patch.theme = item as Preferences['theme'];
        break;
      case 'deletionMode':
        if (item !== 'trash' && item !== 'permanent') throw new Error('删除方式无效。');
        patch.deletionMode = item;
        break;
      case 'petVisible':
      case 'reduceMotion':
        if (typeof item !== 'boolean') throw new Error('设置值必须为开或关。');
        patch[key] = item;
        break;
      case 'petSize':
        if (!isPetSize(item)) throw new Error('宠物大小必须在 50% 至 100% 之间。');
        patch.petSize = item;
        break;
      default:
        throw new Error('包含不支持的设置。');
    }
  }
  return patch;
}

export function clampBounds(bounds: WindowBounds, workArea: WindowBounds): WindowBounds {
  return {
    ...bounds,
    x: Math.round(Math.max(workArea.x, Math.min(bounds.x, workArea.x + Math.max(0, workArea.width - bounds.width)))),
    y: Math.round(Math.max(workArea.y, Math.min(bounds.y, workArea.y + Math.max(0, workArea.height - bounds.height)))),
  };
}

function overlapArea(first: WindowBounds, second: WindowBounds): number {
  const width = Math.max(0, Math.min(first.x + first.width, second.x + second.width) - Math.max(first.x, second.x));
  const height = Math.max(0, Math.min(first.y + first.height, second.y + second.height) - Math.max(first.y, second.y));
  return width * height;
}

function bodyGapError(panel: WindowBounds, body: WindowBounds): number {
  const x = Math.max(0, panel.x - body.x - body.width, body.x - panel.x - panel.width);
  const y = Math.max(0, panel.y - body.y - body.height, body.y - panel.y - panel.height);
  return Math.abs(Math.hypot(x, y) - PET_SETTINGS_GAP);
}

export function getPetSettingsBounds(pet: WindowBounds, workArea: WindowBounds,
  theme: ThemeId = 'munch', growthScale = 1): WindowBounds {
  const relativeBody = getPetBodyBounds(pet.width, theme, growthScale);
  const body = { ...relativeBody, x: pet.x + relativeBody.x, y: pet.y + relativeBody.y };
  const speech = { x: pet.x + 4, y: Math.max(pet.y + 4, body.y - 74), width: pet.width - 8,
    height: Math.min(body.y - pet.y - 14, 64) };
  const centerY = body.y + (body.height - PET_SETTINGS_HEIGHT) / 2;
  const positions = [
    { x: body.x + body.width + PET_SETTINGS_GAP, y: body.y },
    { x: body.x - PET_SETTINGS_WIDTH - PET_SETTINGS_GAP, y: body.y },
    { x: pet.x + pet.width + PET_SETTINGS_GAP, y: centerY },
    { x: pet.x - PET_SETTINGS_WIDTH - PET_SETTINGS_GAP, y: centerY },
    { x: body.x + (body.width - PET_SETTINGS_WIDTH) / 2, y: body.y + body.height + PET_SETTINGS_GAP },
    { x: body.x + (body.width - PET_SETTINGS_WIDTH) / 2, y: speech.y - PET_SETTINGS_HEIGHT - PET_SETTINGS_GAP },
  ];
  const candidates = positions.map(position => clampBounds({ ...position,
    width: PET_SETTINGS_WIDTH, height: PET_SETTINGS_HEIGHT }, workArea));
  // Prefer a close panel even at screen edges; avoid speech when equally close positions fit.
  candidates.sort((first, second) => overlapArea(first, body) - overlapArea(second, body)
    || bodyGapError(first, body) - bodyGapError(second, body)
    || overlapArea(first, speech) - overlapArea(second, speech));
  return candidates[0]!;
}

interface CursorPoint {
  x: number;
  y: number;
}

export class PetDragSession {
  private origin: { bounds: WindowBounds; cursor: CursorPoint } | null = null;

  begin(bounds: WindowBounds, cursor: CursorPoint): void {
    this.origin = { bounds: { ...bounds }, cursor: { ...cursor } };
  }

  move(cursor: CursorPoint, workArea: WindowBounds): WindowBounds | null {
    if (!this.origin) return null;
    return clampBounds({ ...this.origin.bounds,
      x: this.origin.bounds.x + cursor.x - this.origin.cursor.x,
      y: this.origin.bounds.y + cursor.y - this.origin.cursor.y }, workArea);
  }

  end(): void {
    this.origin = null;
  }
}

export function permanentDeletionDetail(batch: PreparedBatch): string {
  const fileCount = batch.entries.reduce((total, entry) => total + entry.fileCount, 0);
  const names = batch.entries.slice(0, 8).map(entry => `• ${entry.name.replace(/[\r\n\t]/g, ' ')}`);
  if (batch.entries.length > 8) names.push(`…以及另外 ${batch.entries.length - 8} 项`);
  return `将永久删除 ${batch.entries.length} 项（共 ${fileCount} 个文件）。\n\n${names.join('\n')}\n\n无法从回收站恢复。此操作是普通永久删除，不保证数据不可恢复。`;
}

export class BatchOwnership {
  private readonly batches = new Map<string, { owner: number; running: boolean }>();
  private readonly preparing = new Set<number>();

  beginPreparation(owner: number): void {
    if (this.preparing.has(owner)) throw new Error('正在检查上一批文件，请稍后再拖入。');
    this.preparing.add(owner);
  }

  finishPreparation(owner: number): void {
    this.preparing.delete(owner);
  }

  add(token: string, owner: number): void {
    this.batches.set(token, { owner, running: false });
  }

  begin(token: string, owner: number): void {
    const batch = this.batches.get(token);
    if (!batch || batch.owner !== owner || batch.running) {
      throw new Error('这批文件已处理、已过期或不属于当前窗口，请重新拖入。');
    }
    batch.running = true;
  }

  finish(token: string): void {
    this.batches.delete(token);
  }

  removeOwner(owner: number): string[] {
    const removed: string[] = [];
    for (const [token, batch] of this.batches) {
      if (batch.owner === owner && !batch.running) {
        this.batches.delete(token);
        removed.push(token);
      }
    }
    return removed;
  }
}

export class PendingPreferenceWrites {
  private count = 0;
  private closed = false;

  get hasPending(): boolean { return this.count > 0; }

  begin(): void {
    if (this.closed) throw new Error('file muncher 正在退出，不能继续修改设置。');
    this.count += 1;
  }

  finish(): void {
    if (this.count === 0) throw new Error('No preference write is pending.');
    this.count -= 1;
  }

  close(): void {
    this.closed = true;
  }
}
