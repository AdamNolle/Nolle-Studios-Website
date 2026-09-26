import path from 'node:path';
import { serve } from '@hono/node-server';
import { config, validateConfig } from './config.ts';
import { openDatabase } from './db.ts';
import { seedFromManifest } from './seed.ts';
import { createApp } from './app.ts';

validateConfig(config);
const db = await openDatabase(config);
const seeded = await seedFromManifest(db, path.join(config.root, 'public/media/archive.json'));
if (!seeded.absent) console.log(`Media manifest available: ${seeded.shoots} shoots, ${seeded.photos} photos`);
const app = createApp({ db, settings: config });
const hostname = config.production ? '0.0.0.0' : '127.0.0.1';
const server = serve({ fetch: app.fetch, port: config.port, hostname }, info => {
  console.log(`Nolle CMS listening on http://${hostname}:${info.port}`);
  if (config.altTextUrl) console.log(`Alt-text drafts: ${config.altTextUrl} (npm run alt:model)`);
});

function shutdown() {
  server.close(async () => {
    await app.idle();
    await db.close();
    process.exit(0);
  });
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
