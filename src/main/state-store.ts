import { randomUUID } from 'node:crypto';
import { mkdir, open, readFile, rename, rm, stat } from 'node:fs/promises';
import { dirname } from 'node:path';
import type { AppState, BatchItemResult, PetStats, Preferences, ThemeId } from '../shared/types';
import { isPetSize, PET_SIZE_DEFAULT } from '../shared/pet-layout';

const SCHEMA_VERSION = 1;
const MAX_STATE_BYTES = 16_384;
const THEMES: readonly ThemeId[] = ['munch', 'pixel', 'blade', 'void', 'paper'];
const PREFERENCE_KEYS: readonly (keyof Preferences)[] = ['theme', 'deletionMode', 'petVisible', 'reduceMotion', 'petSize'];

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isCount(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
}

function validatePreferences(value: unknown): asserts value is Preferences {
  if (!isRecord(value) || Object.keys(value).length !== PREFERENCE_KEYS.length || !THEMES.includes(value.theme as ThemeId)
    || (value.deletionMode !== 'trash' && value.deletionMode !== 'permanent')
    || typeof value.petVisible !== 'boolean' || typeof value.reduceMotion !== 'boolean'
    || !isPetSize(value.petSize)) throw new Error('偏好设置格式无效。');
}

function readPreferences(value: unknown): Preferences {
  const migrated: unknown = isRecord(value) && !Object.hasOwn(value, 'petSize')
    ? { ...value, petSize: PET_SIZE_DEFAULT } : value;
  validatePreferences(migrated);
  return { ...migrated };
}

function validateStats(value: unknown): asserts value is PetStats {
  if (!isRecord(value) || Object.keys(value).length !== 3 || !isCount(value.files) || !isCount(value.bytes) || !isCount(value.meals)) throw new Error('宠物统计数据格式无效。');
}

function addCount(current: number, addition: number): number {
  if (!isCount(addition) || !isCount(current + addition)) throw new Error('宠物统计超出可精确保存的范围。');
  return current + addition;
}

export class StateStore {
  private state: AppState = {
    preferences: { theme: 'munch', deletionMode: 'trash', petVisible: true, reduceMotion: false, petSize: PET_SIZE_DEFAULT },
    stats: { files: 0, bytes: 0, meals: 0 },
  };
  private writeQueue: Promise<void> = Promise.resolve();

  constructor(private readonly path: string) {}

  async load(): Promise<AppState> {
    try {
      const info = await stat(this.path);
      if (!info.isFile() || info.size > MAX_STATE_BYTES) throw new Error('状态文件过大或格式不正确。');
      const data: unknown = JSON.parse(await readFile(this.path, 'utf8'));
      if (!isRecord(data) || Object.keys(data).length !== 3 || data.version !== SCHEMA_VERSION) throw new Error('状态文件版本或格式不正确。');
      const preferences = readPreferences(data.preferences);
      validateStats(data.stats);
      this.state = { preferences, stats: { ...data.stats } };
      return this.getState();
    } catch (error) {
      if (error instanceof Error && 'code' in error && error.code === 'ENOENT') return this.getState();
      throw new Error('无法读取已保存的偏好与统计，当前使用安全默认设置。', { cause: error });
    }
  }

  getState(): AppState {
    return { preferences: { ...this.state.preferences }, stats: { ...this.state.stats } };
  }

  async updatePreferences(patch: Partial<Preferences>): Promise<AppState> {
    if (!isRecord(patch) || Object.keys(patch).some((key) => !PREFERENCE_KEYS.includes(key as keyof Preferences))) throw new Error('偏好设置包含未知字段。');
    const preferences: unknown = { ...this.state.preferences, ...patch };
    validatePreferences(preferences);
    this.state = { preferences, stats: this.state.stats };
    await this.persist();
    return this.getState();
  }

  async recordResults(results: BatchItemResult[]): Promise<AppState> {
    const successes = results.filter((result) => result.status === 'success');
    if (successes.length === 0) return this.getState();
    const stats = { ...this.state.stats };
    for (const result of successes) {
      stats.files = addCount(stats.files, result.fileCount);
      stats.bytes = addCount(stats.bytes, result.bytes);
    }
    stats.meals = addCount(stats.meals, 1);
    // Deletion already succeeded; keep counts in memory even when persistence fails.
    this.state = { preferences: this.state.preferences, stats };
    await this.persist();
    return this.getState();
  }

  private async persist(): Promise<void> {
    const snapshot = JSON.stringify({ version: SCHEMA_VERSION, ...this.getState() }, null, 2) + '\n';
    const write = this.writeQueue.then(async () => {
      await mkdir(dirname(this.path), { recursive: true });
      const temporaryPath = `${this.path}.${randomUUID()}.tmp`;
      try {
        const handle = await open(temporaryPath, 'wx', 0o600);
        try {
          await handle.writeFile(snapshot, 'utf8');
          await handle.sync();
        } finally {
          await handle.close();
        }
        await rename(temporaryPath, this.path);
      } finally {
        await rm(temporaryPath, { force: true });
      }
    });
    // Preserve ordering after a failed write while returning that failure to its caller.
    this.writeQueue = write.then(() => undefined, () => undefined);
    try {
      await write;
    } catch (error) {
      throw new Error('文件处理结果已保留在内存，但偏好与统计未能写入磁盘。', { cause: error });
    }
  }
}
