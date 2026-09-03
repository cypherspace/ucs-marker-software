/**
 * Google Drive service — per-user Drive API access using stored refresh tokens.
 *
 * All student files (script PDFs, clip images) live in the lead teacher's Drive
 * folder when use_drive_storage is true, so data never leaves their Google
 * Workspace instance.
 *
 * URI convention: 'drive://<fileId>'
 * The rest of the codebase treats this opaquely; only this module and
 * storage.ts need to know about it.
 */
import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { Readable } from 'node:stream';
import { google } from 'googleapis';
import { db } from '../db.js';
import { config } from '../config.js';

// ---------------------------------------------------------------------------
// Token encryption (AES-256-GCM)
// ---------------------------------------------------------------------------

const ALGO = 'aes-256-gcm';

function encryptToken(plaintext: string): string {
  const key = Buffer.from(config.tokenEncryptionKey, 'hex');
  const iv = randomBytes(12);
  const cipher = createCipheriv(ALGO, key, iv);
  const enc = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  // iv(12) + tag(16) + ciphertext — base64 encoded
  return Buffer.concat([iv, tag, enc]).toString('base64');
}

function decryptToken(ciphertext: string): string {
  const key = Buffer.from(config.tokenEncryptionKey, 'hex');
  const buf = Buffer.from(ciphertext, 'base64');
  const iv = buf.subarray(0, 12);
  const tag = buf.subarray(12, 28);
  const enc = buf.subarray(28);
  const decipher = createDecipheriv(ALGO, key, iv);
  decipher.setAuthTag(tag);
  return decipher.update(enc) + decipher.final('utf8');
}

// ---------------------------------------------------------------------------
// OAuth2 client factory
// ---------------------------------------------------------------------------

async function getOAuth2Client(userId: string) {
  const user = await db('users')
    .where({ id: userId })
    .select('google_drive_refresh_token')
    .first<{ google_drive_refresh_token: string | null }>();

  if (!user?.google_drive_refresh_token) {
    throw new Error(`No Drive refresh token for user ${userId}`);
  }

  const refreshToken = decryptToken(user.google_drive_refresh_token);
  const oauth2 = new google.auth.OAuth2(
    config.googleOAuthClientId,
    config.googleOAuthClientSecret,
  );
  oauth2.setCredentials({ refresh_token: refreshToken });
  return oauth2;
}

// ---------------------------------------------------------------------------
// Download URL cache (avoids hitting Drive API on every image request)
// ---------------------------------------------------------------------------

const urlCache = new Map<string, { url: string; expiresAt: number }>();
const URL_TTL_MS = 5 * 60 * 1000; // 5 minutes

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export function isDriveUri(uri: string): boolean {
  return uri.startsWith('drive://');
}

export function fileIdFromUri(uri: string): string {
  return uri.slice('drive://'.length);
}

/** Store an encrypted refresh token for the user. */
export async function saveRefreshToken(userId: string, refreshToken: string): Promise<void> {
  const encrypted = encryptToken(refreshToken);
  await db('users').where({ id: userId }).update({ google_drive_refresh_token: encrypted });
}

/** Create 'UCS Marking/<examName>/' folder hierarchy in the user's Drive. */
export async function createExamFolder(userId: string, examName: string): Promise<string> {
  const auth = await getOAuth2Client(userId);
  const drive = google.drive({ version: 'v3', auth });

  // Find or create root 'UCS Marking' folder
  const rootSearch = await drive.files.list({
    q: "name='UCS Marking' and mimeType='application/vnd.google-apps.folder' and trashed=false",
    fields: 'files(id)',
    spaces: 'drive',
  });

  let rootId: string;
  if (rootSearch.data.files?.length) {
    rootId = rootSearch.data.files[0].id!;
  } else {
    const root = await drive.files.create({
      requestBody: {
        name: 'UCS Marking',
        mimeType: 'application/vnd.google-apps.folder',
      },
      fields: 'id',
    });
    rootId = root.data.id!;
  }

  // Create exam subfolder
  const folder = await drive.files.create({
    requestBody: {
      name: examName,
      mimeType: 'application/vnd.google-apps.folder',
      parents: [rootId],
    },
    fields: 'id',
  });

  return folder.data.id!;
}

/** Upload a file to a Drive folder. Returns 'drive://<fileId>'. */
export async function uploadFile(
  userId: string,
  folderId: string,
  filename: string,
  data: Buffer,
  mimeType: string,
): Promise<string> {
  const auth = await getOAuth2Client(userId);
  const drive = google.drive({ version: 'v3', auth });

  const res = await drive.files.create({
    requestBody: {
      name: filename,
      parents: [folderId],
    },
    media: {
      mimeType,
      body: Readable.from(data),
    },
    fields: 'id',
  });

  return `drive://${res.data.id!}`;
}

/** Download a file from Drive. Returns raw bytes. */
export async function downloadFile(userId: string, fileId: string): Promise<Buffer> {
  const auth = await getOAuth2Client(userId);
  const drive = google.drive({ version: 'v3', auth });

  const res = await drive.files.get(
    { fileId, alt: 'media' },
    { responseType: 'arraybuffer' },
  );

  return Buffer.from(res.data as ArrayBuffer);
}

/**
 * Get a short-lived download URL for a Drive file.
 * Results cached for 5 minutes to avoid hammering the Drive API during marking.
 */
export async function getDownloadUrl(userId: string, fileId: string): Promise<string> {
  const cached = urlCache.get(fileId);
  if (cached && cached.expiresAt > Date.now()) return cached.url;

  const auth = await getOAuth2Client(userId);
  // Generate a signed download URL using the access token
  const tokenInfo = await auth.getAccessToken();
  const accessToken = tokenInfo.token!;
  const url = `https://www.googleapis.com/drive/v3/files/${fileId}?alt=media&access_token=${encodeURIComponent(accessToken)}`;

  urlCache.set(fileId, { url, expiresAt: Date.now() + URL_TTL_MS });
  return url;
}

/** Write a CSV string to Drive and return the web view URL. */
export async function exportCsv(
  userId: string,
  folderId: string,
  filename: string,
  csv: string,
): Promise<string> {
  const auth = await getOAuth2Client(userId);
  const drive = google.drive({ version: 'v3', auth });

  const res = await drive.files.create({
    requestBody: {
      name: filename,
      parents: [folderId],
    },
    media: {
      mimeType: 'text/csv',
      body: Readable.from(Buffer.from(csv, 'utf8')),
    },
    fields: 'id,webViewLink',
  });

  return res.data.webViewLink!;
}

/** Create a subfolder inside an existing Drive folder. */
export async function createSubfolder(
  userId: string,
  parentFolderId: string,
  name: string,
): Promise<string> {
  const auth = await getOAuth2Client(userId);
  const drive = google.drive({ version: 'v3', auth });

  const res = await drive.files.create({
    requestBody: {
      name,
      mimeType: 'application/vnd.google-apps.folder',
      parents: [parentFolderId],
    },
    fields: 'id',
  });

  return res.data.id!;
}
