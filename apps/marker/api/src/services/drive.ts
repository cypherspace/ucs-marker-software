/**
 * Google Drive service — per-user Drive API access using stored refresh tokens.
 *
 * All student files (script PDFs, clip images, converted handwriting) and the mark scheme live in the lead
 * teacher's Drive folder, so they stay in the school's Google Workspace. (exams.use_drive_storage is ignored.)
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
// Errors
// ---------------------------------------------------------------------------

/**
 * The lead teacher's Google Drive cannot be used: they never connected it, or the connection stopped working
 * (account suspended or removed, app access withdrawn, token expired). Shown to the user as a plain message
 * (HTTP 409 `DRIVE_NOT_CONNECTED`, see middleware/errorHandler.ts).
 */
export class DriveNotConnectedError extends Error {
  readonly code = 'DRIVE_NOT_CONNECTED';
  constructor(detail?: string) {
    super(
      'Google Drive is not connected for this exam\'s lead teacher, or the connection has stopped working. '
      + 'They need to sign out and sign in again with Google, then try once more.'
      + (detail ? ` (${detail})` : ''),
    );
    this.name = 'DriveNotConnectedError';
  }
}

// Google answers a refresh token that no longer works with invalid_grant (400) or 401.
function isAuthFailure(err: unknown): boolean {
  const e = err as { code?: number | string; status?: number; message?: string; response?: { status?: number; data?: { error?: string } } };
  const status = e?.response?.status ?? e?.status ?? (typeof e?.code === 'number' ? e.code : undefined);
  return status === 401
    || e?.response?.data?.error === 'invalid_grant'
    || /invalid_grant|invalid_client|unauthorized_client/i.test(e?.message ?? '');
}

/** Run a Drive call; an authorisation failure becomes DriveNotConnectedError and forgets the cached access token. */
async function viaDrive<T>(userId: string, fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (err) {
    if (err instanceof DriveNotConnectedError) throw err;
    if (isAuthFailure(err)) {
      tokenCache.delete(userId);
      throw new DriveNotConnectedError();
    }
    throw err;
  }
}

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
    throw new DriveNotConnectedError();
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
  return viaDrive(userId, () => createExamFolderRaw(userId, examName));
}

async function createExamFolderRaw(userId: string, examName: string): Promise<string> {
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
  return viaDrive(userId, async () => {
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
  });
}

/** Replace the contents of an existing Drive file in place (same file id, so nothing else changes). */
export async function updateFile(userId: string, fileId: string, data: Buffer, mimeType: string): Promise<void> {
  await viaDrive(userId, async () => {
    const auth = await getOAuth2Client(userId);
    const drive = google.drive({ version: 'v3', auth });
    await drive.files.update({
      fileId,
      media: { mimeType, body: Readable.from(data) },
      fields: 'id',
    });
  });
}

/** Move a Drive file to the bin. A file that is already gone is not an error. */
export async function deleteFile(userId: string, fileId: string): Promise<void> {
  await viaDrive(userId, async () => {
    const auth = await getOAuth2Client(userId);
    const drive = google.drive({ version: 'v3', auth });
    try {
      await drive.files.update({ fileId, requestBody: { trashed: true }, fields: 'id' });
    } catch (err) {
      const status = (err as { code?: number; response?: { status?: number } }).response?.status ?? (err as { code?: number }).code;
      if (status !== 404) throw err;
    }
  });
}

/** Whether a Drive folder is still there: 'ok', 'trashed' or 'missing' (deleted, or no longer visible to this app). */
export async function folderState(userId: string, folderId: string): Promise<'ok' | 'trashed' | 'missing'> {
  return viaDrive(userId, async () => {
    const auth = await getOAuth2Client(userId);
    const drive = google.drive({ version: 'v3', auth });
    try {
      const res = await drive.files.get({ fileId: folderId, fields: 'id,trashed' });
      return res.data.trashed ? 'trashed' : 'ok';
    } catch (err) {
      const status = (err as { code?: number; response?: { status?: number } }).response?.status ?? (err as { code?: number }).code;
      if (status === 404) return 'missing';
      throw err;
    }
  });
}

/** Download a file from Drive. Returns raw bytes. */
export async function downloadFile(userId: string, fileId: string): Promise<Buffer> {
  return viaDrive(userId, async () => {
    const auth = await getOAuth2Client(userId);
    const drive = google.drive({ version: 'v3', auth });

    const res = await drive.files.get(
      { fileId, alt: 'media' },
      { responseType: 'arraybuffer' },
    );

    return Buffer.from(res.data as ArrayBuffer);
  });
}

const tokenCache = new Map<string, { token: string; expiresAt: number }>();
const TOKEN_TTL_MS = 30 * 60 * 1000;

/**
 * A Drive media URL plus an Authorization header, for server-to-server fetches
 * (the extractor). Keeps the access token out of the URL, and so out of logs.
 */
export async function getDriveMediaRequest(
  userId: string,
  fileId: string,
): Promise<{ url: string; headers: Record<string, string> }> {
  let entry = tokenCache.get(userId);
  if (!entry || entry.expiresAt <= Date.now()) {
    const token = await viaDrive(userId, async () => {
      const auth = await getOAuth2Client(userId);
      return (await auth.getAccessToken()).token;
    });
    if (!token) throw new DriveNotConnectedError('no access token');
    entry = { token, expiresAt: Date.now() + TOKEN_TTL_MS };
    tokenCache.set(userId, entry);
  }
  return {
    url: `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(fileId)}?alt=media`,
    headers: { Authorization: `Bearer ${entry.token}` },
  };
}

/** Write a CSV string to Drive and return the web view URL. */
export async function exportCsv(
  userId: string,
  folderId: string,
  filename: string,
  csv: string,
): Promise<string> {
  return viaDrive(userId, async () => {
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
  });
}

/** Create a subfolder inside an existing Drive folder. */
export async function createSubfolder(
  userId: string,
  parentFolderId: string,
  name: string,
): Promise<string> {
  return viaDrive(userId, async () => {
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
  });
}
