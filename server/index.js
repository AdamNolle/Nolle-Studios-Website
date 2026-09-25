import path from 'node:path';
import { config, validateConfig } from './config.js';
import { openDatabase } from './db.js';
import { seedFromManifest } from './seed.js';
import { createApp } from './app.js';

validateConfig(config);
const db = await openDatabase(config);
const seeded = await seedFromManifest(db, path.join(config.root, 'public/media/archive.json'));
if (!seeded.absent) console.log(`Media manifest available: ${seeded.shoots} shoots, ${seeded.photos} photos`);
const app = createApp({ db, settings: config });
const listenHost = config.production ? '0.0.0.0' : '127.0.0.1';
const server = app.listen(config.port, listenHost, () => {
  console.log(`Nolle CMS listening on http://${listenHost}:${config.port}`);
});

async function shutdown() {
  server.close(async () => { await db.close(); process.exit(0); });
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
