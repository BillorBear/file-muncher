import { isAbsolute, join } from 'node:path';

const LEGACY_PROFILE_NAME = '文件粉碎机';

export function getProfilePath(appDataPath: string, override?: string): string {
  if (!override) return join(appDataPath, LEGACY_PROFILE_NAME);
  if (!isAbsolute(override)) throw new Error('FILE_MUNCHER_USER_DATA must be an absolute path.');
  return override;
}
