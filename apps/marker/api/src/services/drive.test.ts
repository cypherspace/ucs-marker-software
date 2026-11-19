import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ userRow: { value: null as null | { google_drive_refresh_token: string | null } }, filesGet: vi.fn(), filesUpdate: vi.fn() }));
vi.mock('../db.js', () => ({
  db: () => ({ where: () => ({ select: () => ({ first: async () => mocks.userRow.value }) }) }),
}));
vi.mock('../config.js', () => ({
  config: { tokenEncryptionKey: '0'.repeat(64), googleOAuthClientId: 'id', googleOAuthClientSecret: 'secret' },
}));
vi.mock('googleapis', () => ({
  google: {
    auth: { OAuth2: class { setCredentials() {} async getAccessToken() { return { token: 'tok' }; } } },
    drive: () => ({ files: { get: mocks.filesGet, update: mocks.filesUpdate, create: vi.fn() } }),
  },
}));

import { DriveNotConnectedError, deleteFile, folderState } from './drive.js';

// A real encrypted token (the module decrypts it before use)
const withToken = async () => { mocks.userRow.value = { google_drive_refresh_token: await encrypt() }; };
async function encrypt(): Promise<string> {
  const { createCipheriv, randomBytes } = await import('node:crypto');
  const key = Buffer.from('0'.repeat(64), 'hex');
  const iv = randomBytes(12);
  const c = createCipheriv('aes-256-gcm', key, iv);
  const enc = Buffer.concat([c.update('refresh', 'utf8'), c.final()]);
  return Buffer.concat([iv, c.getAuthTag(), enc]).toString('base64');
}

beforeEach(() => { mocks.filesGet.mockReset(); mocks.filesUpdate.mockReset(); });

describe('Drive errors', () => {
  it('a teacher with no stored Drive token gets DRIVE_NOT_CONNECTED', async () => {
    mocks.userRow.value = { google_drive_refresh_token: null };
    await expect(folderState('lead', 'f1')).rejects.toBeInstanceOf(DriveNotConnectedError);
    await expect(folderState('lead', 'f1')).rejects.toMatchObject({ code: 'DRIVE_NOT_CONNECTED' });
  });

  it('a refresh token Google no longer accepts (invalid_grant, or 401) becomes DRIVE_NOT_CONNECTED', async () => {
    await withToken();
    mocks.filesGet.mockRejectedValueOnce(Object.assign(new Error('invalid_grant'), { response: { status: 400, data: { error: 'invalid_grant' } } }));
    await expect(folderState('lead', 'f1')).rejects.toBeInstanceOf(DriveNotConnectedError);
    mocks.filesGet.mockRejectedValueOnce(Object.assign(new Error('Login Required'), { code: 401 }));
    await expect(folderState('lead', 'f1')).rejects.toBeInstanceOf(DriveNotConnectedError);
  });

  it('reports a folder in the bin or deleted', async () => {
    await withToken();
    mocks.filesGet.mockResolvedValueOnce({ data: { id: 'f1', trashed: true } });
    expect(await folderState('lead', 'f1')).toBe('trashed');
    mocks.filesGet.mockRejectedValueOnce(Object.assign(new Error('File not found'), { code: 404 }));
    expect(await folderState('lead', 'f1')).toBe('missing');
    mocks.filesGet.mockResolvedValueOnce({ data: { id: 'f1' } });
    expect(await folderState('lead', 'f1')).toBe('ok');
  });

  it('other Drive failures are not disguised as a lost connection', async () => {
    await withToken();
    mocks.filesGet.mockRejectedValueOnce(Object.assign(new Error('Backend error'), { code: 500 }));
    await expect(folderState('lead', 'f1')).rejects.not.toBeInstanceOf(DriveNotConnectedError);
  });

  it('deleting a file that is already gone is not an error', async () => {
    await withToken();
    mocks.filesUpdate.mockRejectedValueOnce(Object.assign(new Error('File not found'), { code: 404 }));
    await expect(deleteFile('lead', 'f1')).resolves.toBeUndefined();
  });
});
