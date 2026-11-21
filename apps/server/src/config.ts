import { randomBytes } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const env = process.env;
const isProd = env.NODE_ENV === 'production';
const here = path.dirname(fileURLToPath(import.meta.url));

function secret(name: string): string {
  const v = env[name];
  if (v) return v;
  if (isProd) throw new Error(`${name} must be set in production`);
  return `dev-${name}-${randomBytes(4).toString('hex')}`;
}

const AREA_DOMAINS: Record<string, [string, string]> = {
  SG: ['api.sg-light-api.com', 'api-b.sg-light-api.com'],
  NA: ['api.us-light-api.com', 'api-b.us-light-api.com'],
  SAU: ['api.sau-light-api.com', 'api-b.sau-light-api.com'],
};

// Accept both naming styles: NEXCONN_API_PRIMARY/BACKUP and NEXCONN_PRIMARY_API_DOMAIN/SECONDARY_API_DOMAIN (Go SDK style).
const host = (v?: string) => (v ? v.trim().replace(/^https?:\/\//, '').replace(/\/.*$/, '') : undefined);
const primaryDomain = host(env.NEXCONN_API_PRIMARY ?? env.NEXCONN_PRIMARY_API_DOMAIN);
const backupDomain = host(env.NEXCONN_API_BACKUP ?? env.NEXCONN_SECONDARY_API_DOMAIN);
// The client SDK needs the data centre too; infer it from the API domain when NEXCONN_AREA is not set.
const inferredArea = primaryDomain?.includes('us-light-api') ? 'NA' : primaryDomain?.includes('sau-light-api') ? 'SAU' : 'SG';
const area = (env.NEXCONN_AREA || inferredArea).toUpperCase() as 'SG' | 'NA' | 'SAU';
const appKey = env.NEXCONN_APP_KEY ?? '';
const appSecret = env.NEXCONN_APP_SECRET ?? '';
const chatMode = (env.CHAT_MODE as 'nexconn' | 'local' | undefined) ?? (appKey && appSecret ? 'nexconn' : 'local');
if (chatMode === 'nexconn' && !(appKey && appSecret)) throw new Error('CHAT_MODE=nexconn needs NEXCONN_APP_KEY and NEXCONN_APP_SECRET');

export const config = {
  isProd,
  port: Number(env.PORT ?? 8787),
  databaseUrl: env.DATABASE_URL ?? 'postgres://pinthread:pinthread@localhost:5432/pinthread',
  /** Absolute origin used in links and image URLs sent through Nexconn. Empty means relative URLs (local mode). */
  publicUrl: (env.PUBLIC_URL ?? env.RENDER_EXTERNAL_URL ?? '').replace(/\/$/, ''),
  sessionSecret: secret('SESSION_SECRET'),
  inviteSecret: secret('INVITE_SECRET'),
  adminKey: env.ADMIN_KEY ?? (isProd ? '' : 'dev-admin'),
  chatMode,
  nexconn: {
    appKey,
    appSecret,
    area,
    domains: [primaryDomain ?? AREA_DOMAINS[area][0], backupDomain ?? (primaryDomain ? primaryDomain : AREA_DOMAINS[area][1])] as [string, string],
  },
  poolSize: Number(env.DEMO_POOL_SIZE ?? (isProd ? 5 : 2)),
  demoTtlHours: Number(env.DEMO_TTL_HOURS ?? 48),
  maxDemoClaimsPerDay: Number(env.MAX_DEMO_CLAIMS_PER_DAY ?? 400),
  maxPinsPerProject: 29, // 5 fixed + 29 pins stays under Nexconn's 50-subchannel cap with margin
  webDist: env.WEB_DIST ?? path.resolve(here, '../../web/dist'),
};
export type Config = typeof config;
