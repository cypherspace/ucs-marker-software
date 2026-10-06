import { config } from '../config.js';

let cached: { token: string; expiresAt: number } | null = null;

// On Cloud Run the extractor is private; callers must present an ID token for its URL.
async function idToken(audience: string): Promise<string> {
  if (cached && cached.expiresAt > Date.now()) return cached.token;
  const res = await fetch(
    `http://metadata.google.internal/computeMetadata/v1/instance/service-accounts/default/identity?audience=${encodeURIComponent(audience)}`,
    { headers: { 'Metadata-Flavor': 'Google' } },
  );
  if (!res.ok) throw new Error(`Failed to fetch extractor ID token: ${res.status}`);
  const token = await res.text();
  cached = { token, expiresAt: Date.now() + 50 * 60 * 1000 };
  return token;
}

export async function extractorFetch(path: string, init: RequestInit = {}): Promise<Response> {
  const base = config.extractorUrl.replace(/\/$/, '');
  const headers = new Headers(init.headers);
  if (base.startsWith('https://')) headers.set('Authorization', `Bearer ${await idToken(base)}`);
  return fetch(`${base}${path}`, { ...init, headers });
}
