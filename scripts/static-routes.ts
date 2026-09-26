import { copyFile, mkdir } from 'node:fs/promises';

// GitHub Pages serves /archive/ from its own index.html.
const source = new URL('../dist/index.html', import.meta.url);
const archiveDirectory = new URL('../dist/archive/', import.meta.url);

await mkdir(archiveDirectory, { recursive: true });
await copyFile(source, new URL('index.html', archiveDirectory));
// GitHub Pages answers unknown paths with 404.html: the same app, which
// shows its not-found screen for any path other than / and /archive/.
await copyFile(source, new URL('../dist/404.html', import.meta.url));
console.log('Static routes ready: /archive/ and 404.html');
