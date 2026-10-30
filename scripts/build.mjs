import { build } from 'esbuild';
import { mkdir, copyFile } from 'node:fs/promises';

await mkdir('dist', { recursive: true });
await Promise.all([
  build({ entryPoints: ['src/main/main.ts'], outfile: 'dist/main.cjs', bundle: true, platform: 'node', format: 'cjs', external: ['electron'], sourcemap: true }),
  build({ entryPoints: ['src/main/preload.ts'], outfile: 'dist/preload.cjs', bundle: true, platform: 'node', format: 'cjs', external: ['electron'] }),
  build({ entryPoints: ['src/renderer/app.ts'], outfile: 'dist/app.js', bundle: true, platform: 'browser', target: 'es2022', sourcemap: true }),
  copyFile('src/renderer/index.html', 'dist/index.html'),
  copyFile('assets/icon.svg', 'dist/icon.svg')
]);
try { await copyFile('assets/icon.png', 'dist/icon.png'); } catch (error) { if (error.code !== 'ENOENT') throw error; }
console.log('Built desktop application in dist/');
