import { randomUUID } from 'node:crypto';
import type { BigIntStats } from 'node:fs';
import { lstat, readdir, realpath, rm } from 'node:fs/promises';
import { homedir } from 'node:os';
import { basename, dirname, isAbsolute, join, parse, relative, resolve, sep } from 'node:path';
import type { BatchItemResult, DeletionMode, PreparedBatch, PreparedEntry } from '../shared/types';

const MAX_DROP_PATHS = 200;
const MAX_PENDING_BATCHES = 32;
const DEFAULT_TOKEN_TTL_MS = 2 * 60 * 1000;
const DEFAULT_MAX_ENTRIES = 100_000;
const DEFAULT_MAX_SCAN_MS = 10_000;

export interface FileServiceOptions {
  trash: (path: string) => Promise<void>;
  home?: string;
  platform?: NodeJS.Platform;
  protectedPaths?: string[];
  now?: () => number;
  tokenTtlMs?: number;
  maxEntries?: number;
  maxScanMs?: number;
}

interface Candidate {
  path: string;
  name: string;
  kind: PreparedEntry['kind'];
}

interface ScannedEntry extends Candidate {
  publicEntry: PreparedEntry;
  fingerprint: Map<string, string>;
}

interface PendingBatch {
  batch: PreparedBatch;
  entries: ScannedEntry[];
  expiresAt: number;
}

interface ScanBudget {
  startedAt: number;
  visited: number;
}

class FileSafetyError extends Error {}

function errorCode(error: unknown): string | undefined {
  if (error instanceof Error && 'code' in error && typeof error.code === 'string') return error.code;
  return undefined;
}

function userMessage(error: unknown): string {
  if (error instanceof FileSafetyError) return error.message;
  switch (errorCode(error)) {
    case 'ENOENT': return '项目已不存在，请重新选择。';
    case 'EACCES':
    case 'EPERM': return '没有操作权限，请检查系统授权或文件是否被占用。';
    case 'EBUSY': return '项目正在使用中，请关闭相关程序后重试。';
    case 'ELOOP': return '链接路径异常，无法安全处理。';
    case 'ENOTDIR': return '路径已发生变化，请重新选择。';
    default: return '文件操作失败，请检查权限、文件占用和磁盘状态后重试。';
  }
}

function kindOf(stat: BigIntStats): PreparedEntry['kind'] {
  if (stat.isSymbolicLink()) return 'symlink';
  if (stat.isDirectory()) return 'directory';
  if (stat.isFile()) return 'file';
  throw new FileSafetyError('不支持设备、套接字等特殊文件。');
}

function fingerprint(stat: BigIntStats): string {
  return [stat.dev, stat.ino, stat.mode, stat.size, stat.mtimeNs, stat.ctimeNs].join(':');
}

function safeAdd(left: number, right: number): number {
  const result = left + right;
  if (!Number.isSafeInteger(result) || result < 0) throw new FileSafetyError('文件统计超出可安全处理的范围。');
  return result;
}

export class FileService {
  private readonly options: FileServiceOptions;
  private readonly home: string;
  private readonly platform: NodeJS.Platform;
  private readonly now: () => number;
  private readonly batches = new Map<string, PendingBatch>();
  private executing = false;

  constructor(options: FileServiceOptions) {
    this.options = options;
    this.home = resolve(options.home ?? homedir());
    this.platform = options.platform ?? process.platform;
    this.now = options.now ?? Date.now;
  }

  async prepare(paths: string[], mode: DeletionMode): Promise<PreparedBatch> {
    if (!Array.isArray(paths) || paths.length > MAX_DROP_PATHS) throw new FileSafetyError(`每批最多处理 ${MAX_DROP_PATHS} 个拖入项目。`);
    if (mode !== 'trash' && mode !== 'permanent') throw new FileSafetyError('删除模式无效。');
    this.purgeExpired();
    if (this.batches.size >= MAX_PENDING_BATCHES) throw new FileSafetyError('待处理批次过多，请先完成已有操作。');

    const batch: PreparedBatch = { token: randomUUID(), entries: [], rejected: [], mode };
    const protectedPaths = await this.protectedPaths();
    const candidates: Candidate[] = [];
    for (const input of paths) {
      const name = typeof input === 'string' ? basename(input) || input : '未知项目';
      try {
        if (typeof input === 'string' && this.platform === 'win32') {
          const windowsInput = input.replaceAll('/', '\\');
          if (windowsInput.startsWith('\\\\?\\') || windowsInput.startsWith('\\\\.\\') || windowsInput.startsWith('\\??\\')) throw new FileSafetyError('暂不支持 Windows 设备或扩展命名空间路径，请使用普通文件路径。');
        }
        if (typeof input !== 'string' || !isAbsolute(input) || input.includes('\0')) throw new FileSafetyError('请通过拖入或文件选择器提供完整文件路径。');
        const path = await this.canonicalEntryPath(input);
        const stat = await lstat(path, { bigint: true });
        const kind = kindOf(stat);
        this.assertAllowed(path, kind, protectedPaths);
        if (!candidates.some((entry) => this.key(entry.path) === this.key(path))) candidates.push({ path, name: basename(path), kind });
      } catch (error) {
        batch.rejected.push({ name, message: userMessage(error) });
      }
    }

    const selected = candidates.filter((entry) => !candidates.some((parent) => parent !== entry && parent.kind === 'directory' && this.contains(parent.path, entry.path)));
    const entries: ScannedEntry[] = [];
    const budget: ScanBudget = { startedAt: this.now(), visited: 0 };
    for (const candidate of selected) {
      try {
        const entry = await this.scan(candidate, protectedPaths, budget);
        entries.push(entry);
        batch.entries.push(entry.publicEntry);
      } catch (error) {
        batch.rejected.push({ name: candidate.name, message: userMessage(error) });
      }
    }
    this.batches.set(batch.token, { batch, entries, expiresAt: this.now() + (this.options.tokenTtlMs ?? DEFAULT_TOKEN_TTL_MS) });
    return structuredClone(batch);
  }

  getBatch(token: string): PreparedBatch | null {
    this.purgeExpired();
    const pending = this.batches.get(token);
    return pending ? structuredClone(pending.batch) : null;
  }

  async execute(token: string): Promise<BatchItemResult[]> {
    this.purgeExpired();
    const pending = this.batches.get(token);
    if (!pending) throw new FileSafetyError('此批次已完成、已取消或已过期，请重新拖入。');
    if (this.executing) throw new FileSafetyError('另一批文件正在处理中，请稍后重试。');
    this.batches.delete(token);
    this.executing = true;
    const results: BatchItemResult[] = [];
    try {
      const protectedPaths = await this.protectedPaths();
      const budget: ScanBudget = { startedAt: this.now(), visited: 0 };
      for (const entry of pending.entries) {
        try {
          // Resolve parents again to detect a renamed parent replaced by a link.
          const currentPath = await this.canonicalEntryPath(entry.path);
          if (this.key(currentPath) !== this.key(entry.path)) throw new FileSafetyError('路径在确认后发生了变化，请重新拖入。');
          const current = await this.scan(entry, protectedPaths, budget);
          if (!this.sameSnapshot(entry.fingerprint, current.fingerprint)) throw new FileSafetyError('文件或文件夹内容在确认后发生了变化，请重新拖入。');
          const deletionStartedAt = this.now();
          try {
            if (pending.batch.mode === 'trash') await this.options.trash(entry.path);
            else await rm(entry.path, { recursive: entry.kind === 'directory', force: false, maxRetries: 0 });
          } finally {
            // The scan budget excludes deletion I/O, including unsuccessful attempts.
            budget.startedAt += Math.max(0, this.now() - deletionStartedAt);
          }
          results.push({ name: entry.name, status: 'success', fileCount: entry.publicEntry.fileCount, bytes: entry.publicEntry.bytes });
        } catch (error) {
          const partialWarning = pending.batch.mode === 'permanent' && entry.kind === 'directory' ? ' 文件夹可能已部分删除，请检查剩余内容。' : '';
          results.push({ name: entry.name, status: 'error', fileCount: 0, bytes: 0, message: userMessage(error) + partialWarning });
        }
      }
      return results;
    } finally {
      this.executing = false;
    }
  }

  cancel(token: string): void {
    this.batches.delete(token);
  }

  private purgeExpired(): void {
    const now = this.now();
    for (const [token, pending] of this.batches) if (pending.expiresAt <= now) this.batches.delete(token);
  }

  private key(path: string): string {
    return resolve(path);
  }

  private protectionKey(path: string): string {
    const normalized = this.key(path);
    return this.platform === 'win32' || this.platform === 'darwin' ? normalized.toLocaleLowerCase('en-US') : normalized;
  }

  private contains(parent: string, child: string): boolean {
    const difference = relative(this.key(parent), this.key(child));
    return difference === '' || (difference !== '..' && !difference.startsWith(`..${sep}`) && !isAbsolute(difference));
  }

  private protectedContains(parent: string, child: string): boolean {
    return this.contains(this.protectionKey(parent), this.protectionKey(child));
  }

  private async canonicalEntryPath(input: string): Promise<string> {
    const absolute = resolve(input);
    // Keep the last path component unresolved: deleting a link must never delete its target.
    const entryPath = join(await realpath(dirname(absolute)), basename(absolute));
    return (await lstat(entryPath)).isSymbolicLink() ? entryPath : realpath(entryPath);
  }

  private async protectedPaths(): Promise<{ home: string; trees: string[] }> {
    const system = this.platform === 'win32'
      ? [process.env.SystemRoot ?? 'C:\\Windows', process.env.ProgramFiles ?? 'C:\\Program Files', process.env['ProgramFiles(x86)'] ?? 'C:\\Program Files (x86)', process.env.ProgramData ?? 'C:\\ProgramData']
      : ['/System', '/Library', '/Applications', '/bin', '/sbin', '/usr', '/etc', '/dev', '/proc', '/sys', '/boot', '/private/etc', '/private/var/db', '/private/var/root', '/private/var/log'];
    const trees: string[] = [];
    for (const path of [...system, ...(this.options.protectedPaths ?? [])]) {
      trees.push(resolve(path));
      try {
        trees.push(await realpath(path));
      } catch (error) {
        if (errorCode(error) !== 'ENOENT' && errorCode(error) !== 'ENOTDIR') throw error;
      }
    }
    return { home: await realpath(this.home), trees };
  }

  private assertAllowed(path: string, kind: PreparedEntry['kind'], protectedPaths: { home: string; trees: string[] }): void {
    if (this.protectionKey(path) === this.protectionKey(parse(path).root) || this.protectionKey(path) === this.protectionKey(protectedPaths.home)) throw new FileSafetyError('不能删除磁盘根目录或用户主目录。');
    if (kind === 'directory' && this.protectedContains(path, protectedPaths.home)) throw new FileSafetyError('此文件夹包含用户主目录，不能删除。');
    for (const protectedPath of protectedPaths.trees) {
      if (this.protectedContains(protectedPath, path) || (kind === 'directory' && this.protectedContains(path, protectedPath))) throw new FileSafetyError('此项目属于或包含系统、应用或数据保护目录，不能删除。');
    }
  }

  private async scan(candidate: Candidate, protectedPaths: { home: string; trees: string[] }, budget: ScanBudget): Promise<ScannedEntry> {
    const snapshots = new Map<string, string>();
    const stack = [candidate.path];
    let fileCount = 0;
    let bytes = 0;
    let rootDevice: bigint | undefined;
    while (stack.length > 0) {
      budget.visited += 1;
      if (budget.visited > (this.options.maxEntries ?? DEFAULT_MAX_ENTRIES)) throw new FileSafetyError('批次文件数量超过安全统计上限，请拆分后处理。');
      if (this.now() - budget.startedAt > (this.options.maxScanMs ?? DEFAULT_MAX_SCAN_MS)) throw new FileSafetyError('文件统计超时，请拆分文件夹后重试。');
      const path = stack.pop();
      if (!path) break;
      const stat = await lstat(path, { bigint: true });
      const kind = kindOf(stat);
      this.assertAllowed(path, kind, protectedPaths);
      if (rootDevice === undefined) {
        rootDevice = stat.dev;
        if (kind !== candidate.kind) throw new FileSafetyError('文件类型发生变化，请重新拖入。');
        if (kind === 'directory' && (await lstat(dirname(path), { bigint: true })).dev !== stat.dev) throw new FileSafetyError('不能删除挂载的磁盘根目录。');
      } else if (stat.dev !== rootDevice) throw new FileSafetyError('文件夹包含其他挂载磁盘，请单独选择其中的文件。');
      snapshots.set(path, fingerprint(stat));
      if (kind === 'directory') {
        const children = await readdir(path);
        if (budget.visited + stack.length + children.length > (this.options.maxEntries ?? DEFAULT_MAX_ENTRIES)) throw new FileSafetyError('批次文件数量超过安全统计上限，请拆分后处理。');
        for (const child of children) stack.push(join(path, child));
      } else {
        fileCount = safeAdd(fileCount, 1);
        bytes = safeAdd(bytes, Number(stat.size));
      }
    }
    return { ...candidate, publicEntry: { id: randomUUID(), name: candidate.name, kind: candidate.kind, fileCount, bytes }, fingerprint: snapshots };
  }

  private sameSnapshot(previous: Map<string, string>, current: Map<string, string>): boolean {
    if (previous.size !== current.size) return false;
    for (const [path, value] of previous) if (current.get(path) !== value) return false;
    return true;
  }
}
