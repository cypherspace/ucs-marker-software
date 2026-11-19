import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  uploadFile: vi.fn(), updateFile: vi.fn(), deleteFile: vi.fn(), read: vi.fn(), del: vi.fn(),
}));
vi.mock('./drive.js', () => ({
  uploadFile: mocks.uploadFile, updateFile: mocks.updateFile, deleteFile: mocks.deleteFile,
  isDriveUri: (u: string) => u.startsWith('drive://'), fileIdFromUri: (u: string) => u.slice('drive://'.length),
}));
vi.mock('./storage.js', () => ({ storage: { read: mocks.read, delete: mocks.del } }));

import { clipTempKey, discardStored, moveToDrive } from './driveCopy.js';

beforeEach(() => {
  for (const m of Object.values(mocks)) m.mockReset();
  mocks.read.mockResolvedValue(Buffer.from('png'));
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

describe('moveToDrive', () => {
  it('uploads to Drive, then deletes the temporary copy and returns the Drive URI', async () => {
    mocks.uploadFile.mockResolvedValue('drive://abc');
    const out = await moveToDrive('lead', 'folder', 'clip.png', 'gs://b/clips/q/s.png', 'image/png');
    expect(out).toBe('drive://abc');
    expect(mocks.uploadFile).toHaveBeenCalledWith('lead', 'folder', 'clip.png', Buffer.from('png'), 'image/png');
    expect(mocks.del).toHaveBeenCalledWith('gs://b/clips/q/s.png');
  });

  it('throws when the Drive upload fails and leaves the temporary file for a retry (nothing quietly stays in the bucket)', async () => {
    mocks.uploadFile.mockRejectedValue(new Error('quota'));
    await expect(moveToDrive('lead', 'folder', 'clip.png', 'gs://b/clips/q/s.png', 'image/png')).rejects.toThrow('quota');
    expect(mocks.del).not.toHaveBeenCalled();
  });

  it('updates the previous Drive file in place instead of leaving it behind', async () => {
    mocks.updateFile.mockResolvedValue(undefined);
    const out = await moveToDrive('lead', 'folder', 'ms.png', 'gs://b/ms-clips/q.png', 'image/png', 'drive://old1');
    expect(out).toBe('drive://old1');
    expect(mocks.updateFile).toHaveBeenCalledWith('lead', 'old1', Buffer.from('png'), 'image/png');
    expect(mocks.uploadFile).not.toHaveBeenCalled();
    expect(mocks.del).toHaveBeenCalledWith('gs://b/ms-clips/q.png');
  });

  it('makes a new Drive file when the old one can no longer be updated', async () => {
    mocks.updateFile.mockRejectedValue(new Error('File not found'));
    mocks.uploadFile.mockResolvedValue('drive://new1');
    expect(await moveToDrive('lead', 'folder', 'ms.png', 'gs://b/x.png', 'image/png', 'drive://old1')).toBe('drive://new1');
  });

  it('does not hide a lost Drive connection behind a new upload', async () => {
    mocks.updateFile.mockRejectedValue(Object.assign(new Error('no drive'), { code: 'DRIVE_NOT_CONNECTED' }));
    await expect(moveToDrive('lead', 'folder', 'ms.png', 'gs://b/x.png', 'image/png', 'drive://old1')).rejects.toThrow('no drive');
    expect(mocks.uploadFile).not.toHaveBeenCalled();
  });

  it('a replacement that is not a Drive file is uploaded fresh', async () => {
    mocks.uploadFile.mockResolvedValue('drive://new1');
    await moveToDrive('lead', 'folder', 'ms.png', 'gs://b/x.png', 'image/png', 'gs://b/ms-clips/q.png');
    expect(mocks.updateFile).not.toHaveBeenCalled();
  });

  it('still returns the Drive URI when only the clean-up fails', async () => {
    mocks.uploadFile.mockResolvedValue('drive://abc');
    mocks.del.mockRejectedValue(new Error('denied'));
    await expect(moveToDrive('lead', 'folder', 'clip.png', 'gs://b/x.png', 'image/png')).resolves.toBe('drive://abc');
  });

  it('never deletes before the upload has succeeded', async () => {
    const order: string[] = [];
    mocks.uploadFile.mockImplementation(async () => { order.push('upload'); return 'drive://abc'; });
    mocks.del.mockImplementation(async () => { order.push('delete'); });
    await moveToDrive('lead', 'folder', 'clip.png', 'gs://b/x.png', 'image/png');
    expect(order).toEqual(['upload', 'delete']);
  });
});

describe('clipTempKey', () => {
  it('matches the key the extractor writes', () => {
    expect(clipTempKey('Q', 'S')).toBe('clips/Q/S.png');
  });
});

describe('discardStored', () => {
  it('bins a Drive file and deletes a bucket one', async () => {
    await discardStored('lead', 'drive://f1');
    expect(mocks.deleteFile).toHaveBeenCalledWith('lead', 'f1');
    await discardStored('lead', 'gs://b/old.png');
    expect(mocks.del).toHaveBeenCalledWith('gs://b/old.png');
  });

  it('does nothing for no file and never throws', async () => {
    await discardStored('lead', null);
    mocks.deleteFile.mockRejectedValue(new Error('denied'));
    await expect(discardStored('lead', 'drive://f1')).resolves.toBeUndefined();
  });
});
