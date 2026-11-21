import { serve } from '@hono/node-server';
import { serveStatic } from '@hono/node-server/serve-static';
import { Hono } from 'hono';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { BOT_USER_ID } from '@pinthread/shared';
import { accountApi } from './account';
import { api, errorHandler, localChat, uploads } from './api';
import { setGateway } from './chat/gateway';
import { createLocalGateway } from './chat/local';
import { createNexconnGateway } from './chat/nexconn';
import { config } from './config';
import { migrate } from './db';
import { cleanupExpired, ensurePool, purgeMismatchedPool } from './demo';
import { log } from './log';
import { startDispatcher } from './outbox';
import { cleanupOrphanFiles } from './team';

export function buildApp() {
  const app = new Hono();
  app.onError(errorHandler);
  app.use('*', async (c, next) => {
    await next();
    c.header('X-Content-Type-Options', 'nosniff');
    c.header('Referrer-Policy', 'strict-origin-when-cross-origin');
  });
  // Public routers first: the authenticated API router guards everything else under /api.
  if (config.chatMode === 'local') app.route('/api/local', localChat);
  app.route('/api/uploads', uploads);
  app.route('/api', accountApi); // cookie-authenticated account routes; per-route guards, so it never blocks the others
  app.route('/api', api);
  app.all('/api/*', c => c.json({ error: 'not_found', message: 'Unknown API route.' }, 404));

  const dist = config.webDist;
  if (existsSync(dist)) {
    const rel = path.relative(process.cwd(), dist) || '.';
    app.use('/assets/*', async (c, next) => { await next(); c.header('Cache-Control', 'public, max-age=31536000, immutable'); });
    app.use('*', serveStatic({ root: rel }));
    const indexPath = path.join(dist, 'index.html');
    app.get('*', c => { c.header('Cache-Control', 'no-cache'); return c.html(readFileSync(indexPath, 'utf8')); }); // SPA fallback (always the current build)
  }
  return app;
}

export async function initGateway() {
  if (config.chatMode === 'nexconn') {
    const g = createNexconnGateway(config.nexconn);
    setGateway(g);
    await g.issueToken(BOT_USER_ID, 'PinThread'); // registers the bot so its cards show a name
  } else {
    setGateway(createLocalGateway());
  }
}

async function main() {
  await migrate();
  await initGateway();
  startDispatcher();
  const app = buildApp();
  serve({ fetch: app.fetch, port: config.port }, info => log.info('server.listening', {
    port: info.port, chatMode: config.chatMode, area: config.nexconn.area, apiDomains: config.nexconn.domains,
    appKeySet: !!config.nexconn.appKey, appSecretSet: !!config.nexconn.appSecret, publicUrl: config.publicUrl || null,
  }));
  await purgeMismatchedPool();
  // Give an outgoing instance (zero-downtime deploy) time to stop before building new demo projects.
  setTimeout(() => void ensurePool(), config.isProd ? 45_000 : 0).unref();
  // An outgoing instance (older code) may have written rows the new schema expects to be filled in; the migration is
  // idempotent, so run it again once that instance has stopped.
  if (config.isProd) setTimeout(() => void migrate().catch(e => log.error('migrate.again', { error: String(e) })), 120_000).unref();
  setInterval(() => void ensurePool(), 30_000).unref();
  setInterval(() => void cleanupExpired().catch(e => log.error('cleanup', { error: String(e) })), 3600_000).unref();
  setInterval(() => void cleanupOrphanFiles().catch(e => log.error('cleanup.files', { error: String(e) })), 3600_000).unref();
}

if (process.env.PINTHREAD_NO_MAIN !== '1') {
  main().catch(e => { log.error('server.fatal', { error: String(e), stack: e?.stack }); process.exit(1); });
}
