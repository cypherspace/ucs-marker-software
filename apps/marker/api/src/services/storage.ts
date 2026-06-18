import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve, relative, isAbsolute } from 'node:path';
import { Storage as GcsClient, type Bucket } from '@google-cloud/storage';
import { config } from '../config.js';

export interface Storage {
  write(key: string, data: Buffer | Uint8Array): Promise<string>;
  read(uri: string): Promise<Buffer>;
  publicUrl(uri: string, ttlSeconds?: number): Promise<string>;
  rawUri(uri: string): string;
}

class LocalStorage implements Storage {
  constructor(private readonly root: string) {}

  async write(key: string, data: Buffer | Uint8Array): Promise<string> {
    const abs = resolve(this.root, key);
    await mkdir(dirname(abs), { recursive: true });
    await writeFile(abs, data);
    return abs;
  }

  async read(uri: string): Promise<Buffer> {
    return readFile(uri);
  }

  async publicUrl(uri: string): Promise<string> {
    const rel = relative(this.root, uri).replaceAll('\\', '/');
    return `/files/${rel}`;
  }

  rawUri(uri: string): string {
    return uri;
  }
}

class GcsStorage implements Storage {
  private readonly bucket: Bucket;

  constructor(bucketName: string) {
    this.bucket = new GcsClient().bucket(bucketName);
  }

  private keyFromUri(uri: string): string {
    if (!uri.startsWith('gs://')) throw new Error(`Not a gs:// URI: ${uri}`);
    const rest = uri.slice('gs://'.length);
    const slash = rest.indexOf('/');
    return slash === -1 ? '' : rest.slice(slash + 1);
  }

  async write(key: string, data: Buffer | Uint8Array): Promise<string> {
    await this.bucket.file(key).save(Buffer.from(data), { resumable: false });
    return `gs://${this.bucket.name}/${key}`;
  }

  async read(uri: string): Promise<Buffer> {
    const key = this.keyFromUri(uri);
    const [buf] = await this.bucket.file(key).download();
    return buf;
  }

  async publicUrl(uri: string, ttlSeconds = 3600): Promise<string> {
    const key = this.keyFromUri(uri);
    const [url] = await this.bucket.file(key).getSignedUrl({
      version: 'v4',
      action: 'read',
      expires: Date.now() + ttlSeconds * 1000,
    });
    return url;
  }

  rawUri(uri: string): string {
    return uri;
  }
}

function buildStorage(): Storage {
  if (config.storageBackend === 'gcs') {
    if (!config.storageBucket) throw new Error('STORAGE_BUCKET required when STORAGE_BACKEND=gcs');
    return new GcsStorage(config.storageBucket);
  }
  return new LocalStorage(config.storageDir);
}

export const storage: Storage = buildStorage();

export function isGcsUri(uri: string): boolean {
  return uri.startsWith('gs://');
}

export function assertLocalPath(uri: string): string {
  if (isGcsUri(uri)) throw new Error(`Expected local path, got gs:// URI: ${uri}`);
  if (!isAbsolute(uri)) return resolve(config.storageDir, uri);
  return uri;
}
