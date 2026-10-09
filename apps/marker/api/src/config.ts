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

function tokenEncryptionKey(): string {
  const v = process.env.TOKEN_ENCRYPTION_KEY;
  if (!v) {
    if (process.env.NODE_ENV === 'production') throw new Error('Missing env var: TOKEN_ENCRYPTION_KEY');
    return '0'.repeat(64);
  }
  if (!/^[0-9a-fA-F]{64}$/.test(v)) throw new Error('TOKEN_ENCRYPTION_KEY must be 64 hex characters (32 bytes)');
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
  geminiModel: process.env.GEMINI_MODEL ?? 'gemini-3.8-flash',
  // Gemini requests per minute this server will make (the free tier allows only a few). Calls beyond it are
  // queued, not failed. Raise it, or set 0 for no limit, once the key is on a paid plan.
  geminiMaxRpm: Number(process.env.GEMINI_MAX_RPM ?? 6),
  googleOAuthClientId: process.env.GOOGLE_OAUTH_CLIENT_ID ?? '',
  googleOAuthClientSecret: process.env.GOOGLE_OAUTH_CLIENT_SECRET ?? '',
  publicUrl: process.env.PUBLIC_URL ?? '',
  frontendUrl: process.env.FRONTEND_URL ?? '',
  allowSignup: process.env.ALLOW_SIGNUP === 'true',
  cookieSecure: (process.env.COOKIE_SECURE ?? (process.env.NODE_ENV === 'production' ? 'true' : 'false')) === 'true',
  tokenEncryptionKey: tokenEncryptionKey(),
  // Test switch: answer AI calls with deterministic fake output instead of calling Gemini.
  aiStub: process.env.AI_STUB === '1',
};
