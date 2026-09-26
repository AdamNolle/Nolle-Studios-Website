import { copyFile, mkdir } from 'node:fs/promises';

// GitHub Pages serves /archive/ from its own index.html.
const source = new URL('../dist/index.html', import.meta.url);
const archiveDirectory = new URL('../dist/archive/', import.meta.url);

await mkdir(archiveDirectory, { recursive: true });
await copyFile(source, new URL('index.html', archiveDirectory));
console.log('Static route ready: /archive/');
