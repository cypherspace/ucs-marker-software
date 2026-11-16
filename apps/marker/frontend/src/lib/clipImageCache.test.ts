import { beforeEach, describe, expect, it, vi } from 'vitest';
import { cachedImage, clearImageCache, preloadImage } from './clipImageCache';

// A stand-in for the browser's Image that loads on the next tick (or fails for URLs containing "bad")
class FakeImage {
  crossOrigin = '';
  onload: (() => void) | null = null;
  onerror: (() => void) | null = null;
  set src(url: string) { setTimeout(() => (url.includes('bad') ? this.onerror?.() : this.onload?.()), 0); }
}

beforeEach(() => {
  vi.stubGlobal('Image', FakeImage);
  clearImageCache();
});

describe('clip image cache', () => {
  it('has nothing for a picture that was never loaded', () => {
    expect(cachedImage('/a.png')).toBeUndefined();
  });

  it('keeps a loaded picture, so the next visit shows it at once', async () => {
    const img = await preloadImage('/a.png');
    expect(cachedImage('/a.png')).toBe(img);
  });

  it('loads cross-origin, the way the canvas reads it', async () => {
    const img = (await preloadImage('/a.png')) as unknown as FakeImage;
    expect(img.crossOrigin).toBe('anonymous');
  });

  it('shares one download between callers', async () => {
    const [a, b] = await Promise.all([preloadImage('/a.png'), preloadImage('/a.png')]);
    expect(a).toBe(b);
  });

  it('forgets the oldest pictures past its limit, keeping recent ones', async () => {
    for (let i = 0; i < 8; i++) await preloadImage(`/${i}.png`);
    cachedImage('/0.png'); // looking at it again makes it recent
    await preloadImage('/8.png');
    expect(cachedImage('/0.png')).toBeDefined();
    expect(cachedImage('/1.png')).toBeUndefined();
    expect(cachedImage('/8.png')).toBeDefined();
  });

  it('does not keep a picture that failed, and can try again', async () => {
    await expect(preloadImage('/bad.png')).rejects.toThrow();
    expect(cachedImage('/bad.png')).toBeUndefined();
    await expect(preloadImage('/bad.png')).rejects.toThrow();
  });

  it('clearing drops everything', async () => {
    await preloadImage('/a.png');
    clearImageCache();
    expect(cachedImage('/a.png')).toBeUndefined();
  });
});
