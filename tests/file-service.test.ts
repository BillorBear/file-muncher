import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, rename, rm, symlink, lstat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test, { type TestContext } from 'node:test';
import { FileService, type FileServiceOptions } from '../src/main/file-service';

async function fixture(t: TestContext, options: Partial<FileServiceOptions> = {}) {
  const root = await mkdtemp(join(tmpdir(), 'munch-service-test-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const home = join(root, 'home');
  await mkdir(home);
  const trashed: string[] = [];
  const service = new FileService({ home, trash: async (path) => { trashed.push(path); }, ...options });
  return { root, home, service, trashed };
}

test('prepares recursive counts without following symbolic links and removes duplicate children', async (t) => {
  const { root, home, service } = await fixture(t);
  const folder = join(home, 'folder');
  await mkdir(folder);
  await writeFile(join(folder, 'one.txt'), 'hello');
  await mkdir(join(folder, 'empty'));
  const target = join(root, 'target.txt');
  await writeFile(target, 'outside');
  await symlink(target, join(folder, 'link'));
  const linkSize = (await lstat(join(folder, 'link'))).size;
  const batch = await service.prepare([join(folder, 'one.txt'), folder, folder], 'trash');
  assert.equal(batch.entries.length, 1);
  assert.equal(batch.entries[0]?.fileCount, 2);
  assert.equal(batch.entries[0]?.bytes, 5 + linkSize);
  assert.equal(batch.rejected.length, 0);
  assert.equal(await readFile(target, 'utf8'), 'outside');
});

test('rejects roots, home, protected descendants and directories containing protected paths', async (t) => {
  const { root, home } = await fixture(t);
  const app = join(home, 'app');
  await mkdir(app);
  const content = join(app, 'important.txt');
  await writeFile(content, 'important');
  const service = new FileService({ home, protectedPaths: [app], trash: async () => assert.fail('must not delete') });
  const batch = await service.prepare(['/', home, root, app, content], 'trash');
  assert.equal(batch.entries.length, 0);
  assert.equal(batch.rejected.length, 5);
});

test('canonicalizes symbolic-link parents before applying protection', async (t) => {
  const { root, home } = await fixture(t);
  const protectedFolder = join(root, 'protected');
  await mkdir(protectedFolder);
  await writeFile(join(protectedFolder, 'secret'), 'secret');
  await symlink(protectedFolder, join(home, 'alias'));
  const service = new FileService({ home, protectedPaths: [protectedFolder], trash: async () => assert.fail('must not delete') });
  const batch = await service.prepare([join(home, 'alias', 'secret')], 'trash');
  assert.equal(batch.entries.length, 0);
  assert.equal(batch.rejected.length, 1);
});

test('permanently removes only a final symbolic link and preserves its target', async (t) => {
  const { root, home, service } = await fixture(t);
  const target = join(root, 'target');
  await mkdir(target);
  await writeFile(join(target, 'safe'), 'keep');
  const link = join(home, 'shortcut');
  await symlink(target, link);
  const batch = await service.prepare([link], 'permanent');
  assert.equal(batch.entries[0]?.kind, 'symlink');
  const results = await service.execute(batch.token);
  assert.equal(results[0]?.status, 'success');
  assert.equal(await readFile(join(target, 'safe'), 'utf8'), 'keep');
  await assert.rejects(lstat(link), { code: 'ENOENT' });
});

test('trash errors stay errors without a permanent-delete fallback', async (t) => {
  const { home, service } = await fixture(t, { trash: async () => { throw new Error('trash unavailable'); } });
  const path = join(home, 'keep.txt');
  await writeFile(path, 'keep');
  const batch = await service.prepare([path], 'trash');
  const results = await service.execute(batch.token);
  assert.equal(results[0]?.status, 'error');
  assert.equal(results[0]?.fileCount, 0);
  assert.equal(await readFile(path, 'utf8'), 'keep');
});

test('returns precise successes and failures in the same batch', async (t) => {
  const { home, service } = await fixture(t, { trash: async (path) => {
    if (path.endsWith('fail.txt')) throw new Error('permission denied');
  } });
  const good = join(home, 'good.txt');
  const bad = join(home, 'fail.txt');
  await writeFile(good, 'good');
  await writeFile(bad, 'bad');
  const batch = await service.prepare([good, bad], 'trash');
  const results = await service.execute(batch.token);
  assert.deepEqual(results.map(({ status, fileCount, bytes }) => ({ status, fileCount, bytes })), [
    { status: 'success', fileCount: 1, bytes: 4 },
    { status: 'error', fileCount: 0, bytes: 0 },
  ]);
});

test('tokens are one-use, cancellable and expire', async (t) => {
  let now = 0;
  const { home, service, trashed } = await fixture(t, { now: () => now, tokenTtlMs: 10 });
  const path = join(home, 'file');
  await writeFile(path, 'data');
  const first = await service.prepare([path], 'trash');
  await service.execute(first.token);
  await assert.rejects(service.execute(first.token));
  const cancelled = await service.prepare([path], 'trash');
  service.cancel(cancelled.token);
  assert.equal(service.getBatch(cancelled.token), null);
  await assert.rejects(service.execute(cancelled.token));
  const expired = await service.prepare([path], 'trash');
  now = 11;
  assert.equal(service.getBatch(expired.token), null);
  await assert.rejects(service.execute(expired.token));
  assert.equal(trashed.length, 1);
});

test('rejects concurrent execution of a batch', async (t) => {
  let finish: (() => void) | undefined;
  const { home, service } = await fixture(t, { trash: () => new Promise<void>((resolve) => { finish = resolve; }) });
  const path = join(home, 'file');
  await writeFile(path, 'data');
  const batch = await service.prepare([path], 'trash');
  const running = service.execute(batch.token);
  await assert.rejects(service.execute(batch.token));
  while (!finish) await new Promise((resolve) => setTimeout(resolve, 1));
  finish();
  assert.equal((await running)[0]?.status, 'success');
});

test('rejects replaced files and changed folder contents after preparation', async (t) => {
  const { home, service, trashed } = await fixture(t);
  const path = join(home, 'original');
  await writeFile(path, 'old');
  const batch = await service.prepare([path], 'trash');
  await rename(path, join(home, 'moved'));
  await writeFile(path, 'new');
  assert.equal((await service.execute(batch.token))[0]?.status, 'error');
  const folder = join(home, 'folder');
  await mkdir(folder);
  await writeFile(join(folder, 'a'), 'a');
  const directoryBatch = await service.prepare([folder], 'trash');
  await writeFile(join(folder, 'b'), 'b');
  assert.equal((await service.execute(directoryBatch.token))[0]?.status, 'error');
  assert.equal(trashed.length, 0);
});

test('rejects directories that exceed the explicit scan limit', async (t) => {
  const { home, service } = await fixture(t, { maxEntries: 2 });
  const folder = join(home, 'folder');
  await mkdir(folder);
  await writeFile(join(folder, 'a'), 'a');
  await writeFile(join(folder, 'b'), 'b');
  const batch = await service.prepare([folder], 'trash');
  assert.equal(batch.entries.length, 0);
  assert.match(batch.rejected[0]?.message ?? '', /上限|过多|超/);
});

test('rejects malformed paths and accepts an empty directory as a zero-file meal', async (t) => {
  const { home, service } = await fixture(t);
  const folder = join(home, 'empty');
  await mkdir(folder);
  const batch = await service.prepare(['relative', '', folder], 'permanent');
  assert.equal(batch.rejected.length, 2);
  assert.equal(batch.entries[0]?.fileCount, 0);
  assert.equal((await service.execute(batch.token))[0]?.status, 'success');
  await assert.rejects(lstat(folder), { code: 'ENOENT' });
});

test('rejects a parent directory swapped for a symbolic link after preparation', async (t) => {
  const { root, home, service, trashed } = await fixture(t);
  const folder = join(home, 'folder');
  const elsewhere = join(root, 'elsewhere');
  await mkdir(folder);
  await mkdir(elsewhere);
  await writeFile(join(folder, 'file'), 'old');
  await writeFile(join(elsewhere, 'file'), 'keep');
  const batch = await service.prepare([join(folder, 'file')], 'trash');
  await rename(folder, join(home, 'moved'));
  await symlink(elsewhere, folder);
  assert.equal((await service.execute(batch.token))[0]?.status, 'error');
  assert.equal(trashed.length, 0);
  assert.equal(await readFile(join(elsewhere, 'file'), 'utf8'), 'keep');
});

test('rejects a file modified in place before execution', async (t) => {
  const { home, service, trashed } = await fixture(t);
  const path = join(home, 'changed');
  await writeFile(path, 'old');
  const batch = await service.prepare([path], 'trash');
  await writeFile(path, 'replacement data');
  assert.equal((await service.execute(batch.token))[0]?.status, 'error');
  assert.equal(trashed.length, 0);
});

test('does not allow renderer mutation of the batch mode or contents', async (t) => {
  const { home, service, trashed } = await fixture(t);
  const path = join(home, 'keep');
  await writeFile(path, 'keep');
  const batch = await service.prepare([path], 'trash');
  batch.mode = 'permanent';
  batch.entries.length = 0;
  const copy = service.getBatch(batch.token);
  assert.equal(copy?.mode, 'trash');
  if (copy) copy.mode = 'permanent';
  await service.execute(batch.token);
  assert.equal(trashed.length, 1);
  assert.equal(await readFile(path, 'utf8'), 'keep');
});

test('rejects too many paths and unknown deletion modes', async (t) => {
  const { service } = await fixture(t);
  await assert.rejects(service.prepare(Array<string>(201).fill('/missing'), 'trash'));
  await assert.rejects(service.prepare([], 'unexpected' as 'trash'));
});

test('rejects scans that exceed the elapsed-time limit', async (t) => {
  let now = 0;
  const { home, service } = await fixture(t, { now: () => now++, maxScanMs: 0 });
  const path = join(home, 'file');
  await writeFile(path, 'data');
  const batch = await service.prepare([path], 'trash');
  assert.equal(batch.entries.length, 0);
  assert.match(batch.rejected[0]?.message ?? '', /超时/);
});

test('slow trash operations do not consume the remaining files scan budget', async (t) => {
  let now = 0;
  const trashed: string[] = [];
  const { home, service } = await fixture(t, {
    now: () => now,
    maxScanMs: 10,
    trash: async (path) => { now += 11; trashed.push(path); },
  });
  const first = join(home, 'first');
  const second = join(home, 'second');
  await writeFile(first, 'a');
  await writeFile(second, 'b');
  const batch = await service.prepare([first, second], 'trash');
  const results = await service.execute(batch.token);
  assert.deepEqual(results.map(result => result.status), ['success', 'success']);
  assert.equal(trashed.length, 2);
});

test('slow failed trash operations do not exhaust the next files scan budget', async (t) => {
  let now = 0;
  const { home, service } = await fixture(t, {
    now: () => now,
    maxScanMs: 10,
    trash: async (path) => {
      now += 11;
      if (path.endsWith('first')) throw new Error('trash unavailable');
    },
  });
  const first = join(home, 'first');
  const second = join(home, 'second');
  await writeFile(first, 'a');
  await writeFile(second, 'b');
  const batch = await service.prepare([first, second], 'trash');
  const results = await service.execute(batch.token);
  assert.deepEqual(results.map(result => result.status), ['error', 'success']);
  assert.equal(results[1]?.fileCount, 1);
});

test('preparing another batch cannot interrupt an in-flight batch', async (t) => {
  let finish: (() => void) | undefined;
  const { home, service } = await fixture(t, { trash: () => new Promise<void>((resolve) => { finish = resolve; }) });
  const path = join(home, 'file');
  await writeFile(path, 'data');
  const first = await service.prepare([path], 'trash');
  const second = await service.prepare([path], 'trash');
  const running = service.execute(first.token);
  await assert.rejects(service.execute(second.token));
  while (!finish) await new Promise((resolve) => setTimeout(resolve, 1));
  finish();
  assert.equal((await running)[0]?.status, 'success');
});

test('explicitly rejects Windows device namespace paths before filesystem access', async (t) => {
  const { service } = await fixture(t, { platform: 'win32' });
  const batch = await service.prepare(['\\\\?\\C:\\Windows', '\\\\.\\C:\\Windows'], 'permanent');
  assert.equal(batch.entries.length, 0);
  assert.equal(batch.rejected.length, 2);
  assert.ok(batch.rejected.every((entry) => /设备|扩展/.test(entry.message)));
});

test('keeps differently cased filenames separate on a case-sensitive filesystem', async (t) => {
  const { home, service } = await fixture(t, { platform: 'darwin' });
  const lower = join(home, 'case');
  const upper = join(home, 'CASE');
  await writeFile(lower, 'lower');
  await writeFile(upper, 'upper');
  if ((await lstat(lower)).ino === (await lstat(upper)).ino) {
    t.skip('The current temporary filesystem is case-insensitive.');
    return;
  }
  const batch = await service.prepare([lower, upper], 'trash');
  assert.equal(batch.entries.length, 2);
});
