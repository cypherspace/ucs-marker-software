import { config as loadEnv } from 'dotenv';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, '../../../..');
loadEnv({ path: resolve(repoRoot, '.env') });

function requiredLocalDb(): string {
  if (process.env.CLOUD_SQL_INSTANCE) return '';
  const v = process.env.DATABASE_URL;
  if (!v) throw new Error('Missing env var: DATABASE_URL');
  return v;
}

export const config = {
  nodeEnv: process.env.NODE_ENV ?? 'development',
  port: Number(process.env.PORT ?? 8080),
  authDisabled: process.env.AUTH_DISABLED === 'true',
  adminUserId: process.env.ADMIN_USER_UUID ?? '00000000-0000-0000-0000-000000000001',
  databaseUrl: requiredLocalDb(),
  extractorUrl: process.env.EXTRACTOR_URL ?? 'http://localhost:8081',
  storageDir: resolve(repoRoot, process.env.STORAGE_DIR ?? 'storage'),
  storageBackend: (process.env.STORAGE_BACKEND ?? 'local') as 'local' | 'gcs',
  storageBucket: process.env.STORAGE_BUCKET,
  googleApiKey: process.env.GOOGLE_API_KEY ?? '',
  geminiModel: process.env.GEMINI_MODEL ?? 'gemini-2.5-flash',
  googleOAuthClientId: process.env.GOOGLE_OAUTH_CLIENT_ID ?? '',
  googleOAuthClientSecret: process.env.GOOGLE_OAUTH_CLIENT_SECRET ?? '',
  publicUrl: process.env.PUBLIC_URL ?? '',
  frontendUrl: process.env.FRONTEND_URL ?? '',
  allowSignup: process.env.ALLOW_SIGNUP === 'true',
  cookieSecure: (process.env.COOKIE_SECURE ?? (process.env.NODE_ENV === 'production' ? 'true' : 'false')) === 'true',
};
