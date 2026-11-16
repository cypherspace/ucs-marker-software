import { useEffect, useState } from 'react';

// Clip images already loaded in this browser tab, so moving between scripts can show the next picture at once instead of
// an empty canvas while it downloads. The marking page also fetches the neighbours' images ahead of time (preloadImage).
// Keyed by the full URL, which carries a version that changes when a clip's pages are re-selected, so an entry is never
// out of date. Kept small: scripts are large images.
const MAX_ENTRIES = 8;
const loaded = new Map<string, HTMLImageElement>();
const loading = new Map<string, Promise<HTMLImageElement>>();

const remember = (url: string, img: HTMLImageElement) => {
  loaded.delete(url);
  loaded.set(url, img); // newest last
  while (loaded.size > MAX_ENTRIES) loaded.delete(loaded.keys().next().value as string);
};

export function cachedImage(url: string): HTMLImageElement | undefined {
  const img = loaded.get(url);
  if (img) remember(url, img); // refresh its place
  return img;
}

// Loads an image the way the canvas reads it (cross-origin, so it can draw on it) and keeps it for next time
export function preloadImage(url: string): Promise<HTMLImageElement> {
  const have = loaded.get(url);
  if (have) return Promise.resolve(have);
  const pending = loading.get(url);
  if (pending) return pending;
  const p = new Promise<HTMLImageElement>((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => { remember(url, img); loading.delete(url); resolve(img); };
    img.onerror = () => { loading.delete(url); reject(new Error('Image failed to load')); };
    img.src = url;
  });
  loading.set(url, p);
  return p;
}

export function clearImageCache(): void {
  loaded.clear();
  loading.clear();
}

export type ImageStatus = 'loading' | 'loaded' | 'failed';

// Like use-image, but a picture that is already in the cache is there on the very first render
export function useClipImage(url: string): [HTMLImageElement | undefined, ImageStatus] {
  const [state, setState] = useState<{ url: string; image?: HTMLImageElement; status: ImageStatus }>(() => {
    const c = cachedImage(url);
    return c ? { url, image: c, status: 'loaded' } : { url, status: 'loading' };
  });

  // A new address: start from the cache if it is there (done while rendering, so there is no empty frame)
  if (state.url !== url) {
    const c = cachedImage(url);
    setState(c ? { url, image: c, status: 'loaded' } : { url, status: 'loading' });
  }

  useEffect(() => {
    if (state.url !== url || state.status !== 'loading') return;
    let live = true;
    preloadImage(url).then(
      (image) => { if (live) setState({ url, image, status: 'loaded' }); },
      () => { if (live) setState({ url, status: 'failed' }); },
    );
    return () => { live = false; };
  }, [url, state.url, state.status]);

  return state.url === url ? [state.image, state.status] : [undefined, 'loading'];
}
