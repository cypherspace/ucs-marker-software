import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  folderState: vi.fn(), createExamFolder: vi.fn(), update: vi.fn(), driveOptional: { value: false },
  DriveNotConnectedError: class extends Error { readonly code = 'DRIVE_NOT_CONNECTED'; },
}));
const DriveNotConnectedError = mocks.DriveNotConnectedError;
vi.mock('./drive.js', () => ({
  folderState: mocks.folderState, createExamFolder: mocks.createExamFolder, DriveNotConnectedError: mocks.DriveNotConnectedError,
}));
vi.mock('../db.js', () => ({ db: () => ({ where: () => ({ update: mocks.update }) }) }));
vi.mock('../config.js', () => ({ config: { get driveOptional() { return mocks.driveOptional.value; } } }));

import { ensureExamFolder, newExamFolder, resetFolderCache } from './driveFolder.js';

const exam = (folder: string | null = null) => ({ id: 'e1', name: 'Year 9 Maths', lead_teacher_id: 'lead', drive_folder_id: folder });

beforeEach(() => {
  for (const m of [mocks.folderState, mocks.createExamFolder, mocks.update]) m.mockReset();
  mocks.driveOptional.value = false;
  resetFolderCache();
  vi.spyOn(console, 'warn').mockImplementation(() => {});
});

describe('ensureExamFolder', () => {
  it('creates and saves a folder when the exam has none', async () => {
    mocks.createExamFolder.mockResolvedValue('new1');
    const e = exam();
    expect(await ensureExamFolder(e)).toBe('new1');
    expect(mocks.createExamFolder).toHaveBeenCalledWith('lead', 'Year 9 Maths');
    expect(mocks.update).toHaveBeenCalledWith({ drive_folder_id: 'new1' });
    expect(e.drive_folder_id).toBe('new1');
  });

  it('uses the stored folder when it is still there, and does not ask Drive again for a few minutes', async () => {
    mocks.folderState.mockResolvedValue('ok');
    expect(await ensureExamFolder(exam('f1'))).toBe('f1');
    expect(await ensureExamFolder(exam('f1'))).toBe('f1');
    expect(mocks.folderState).toHaveBeenCalledTimes(1);
    expect(mocks.createExamFolder).not.toHaveBeenCalled();
  });

  it('makes a new folder when the stored one was put in the bin or deleted', async () => {
    mocks.folderState.mockResolvedValueOnce('trashed').mockResolvedValueOnce('missing');
    mocks.createExamFolder.mockResolvedValueOnce('n1').mockResolvedValueOnce('n2');
    expect(await ensureExamFolder(exam('f1'))).toBe('n1');
    resetFolderCache();
    expect(await ensureExamFolder(exam('f2'))).toBe('n2');
    expect(mocks.update).toHaveBeenCalledWith({ drive_folder_id: 'n1' });
  });

  it('fails with DRIVE_NOT_CONNECTED instead of falling back to the bucket', async () => {
    mocks.createExamFolder.mockRejectedValue(new DriveNotConnectedError('x'));
    await expect(ensureExamFolder(exam())).rejects.toMatchObject({ code: 'DRIVE_NOT_CONNECTED' });
    expect(mocks.update).not.toHaveBeenCalled();
  });

  it('returns null only when DRIVE_OPTIONAL is on (local development)', async () => {
    mocks.createExamFolder.mockRejectedValue(new DriveNotConnectedError('x'));
    mocks.driveOptional.value = true;
    expect(await ensureExamFolder(exam())).toBeNull();
  });

  it('does not hide other failures', async () => {
    mocks.createExamFolder.mockRejectedValue(new Error('Drive is down'));
    mocks.driveOptional.value = true;
    await expect(ensureExamFolder(exam())).rejects.toThrow('Drive is down');
  });
});

describe('newExamFolder', () => {
  it('creates a folder for an exam that does not exist yet, and refuses when Drive is not connected', async () => {
    mocks.createExamFolder.mockResolvedValueOnce('f9');
    expect(await newExamFolder('lead', 'Mocks')).toBe('f9');
    mocks.createExamFolder.mockRejectedValueOnce(new DriveNotConnectedError());
    await expect(newExamFolder('lead', 'Mocks')).rejects.toMatchObject({ code: 'DRIVE_NOT_CONNECTED' });
  });
});
