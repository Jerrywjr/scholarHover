import { build } from 'vite';
import { rm, mkdir, copyFile, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
const root = process.cwd();
const outDir = path.join(root, 'dist');
await rm(outDir, { recursive: true, force: true });
await mkdir(outDir, { recursive: true });
await build({ configFile: false, publicDir: false, build: { outDir, emptyOutDir: false, target: 'chrome120', sourcemap: false,
  lib: { entry: 'src/content/index.ts', name: 'ScholarHover', formats: ['iife'], fileName: () => 'content.js' } } });
await build({ configFile: false, publicDir: 'public', build: { outDir, emptyOutDir: false, target: 'chrome120', sourcemap: false,
  rollupOptions: { input: { background: path.join(root, 'src/background/index.ts'), options: path.join(root, 'options.html'), collection: path.join(root, 'collection.html'), offscreen: path.join(root, 'offscreen.html') },
    output: { entryFileNames: '[name].js', chunkFileNames: 'chunks/[name]-[hash].js', assetFileNames: 'assets/[name]-[hash][extname]' } } } });
const manifest = JSON.parse(await readFile('manifest.json', 'utf8'));
await writeFile(path.join(outDir, 'manifest.json'), JSON.stringify(manifest, null, 2));
for (const suffix of ['', '.en', '.fr', '.de']) {
  const privacy = (await readFile(`docs/privacy${suffix}.md`, 'utf8'))
    .replace(/\]\(privacy(\.(?:en|fr|de))?\.md\)/g, '](PRIVACY$1.md)');
  await writeFile(path.join(outDir, `PRIVACY${suffix}.md`), privacy);
}
await copyFile('../LICENSE', path.join(outDir, 'LICENSE'));
console.log('Chrome extension built in dist/');
