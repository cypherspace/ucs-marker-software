import { useCallback, useEffect, useState, type RefObject } from 'react';

export const MIN_ZOOM = 0.25;
export const MAX_ZOOM = 4;
const STEP = 1.25;

const clamp = (z: number) => Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, Math.round(z * 100) / 100));

function read(key: string): number {
  try {
    const v = Number(window.localStorage.getItem(key));
    return v > 0 ? clamp(v) : 1;
  } catch {
    return 1;
  }
}

/**
 * Zoom as a multiple of "fit to width" (1 = fit), remembered per `storageKey` in this browser.
 * The stored value is only a convenience; the page works when storage is unavailable.
 */
export function useZoom(storageKey: string) {
  const [zoom, setZoomState] = useState(() => read(storageKey));

  const setZoom = useCallback((z: number) => {
    const next = clamp(z);
    setZoomState(next);
    try { window.localStorage.setItem(storageKey, String(next)); } catch { /* storage unavailable */ }
  }, [storageKey]);

  return {
    zoom,
    setZoom,
    zoomIn: useCallback(() => setZoom(zoom * STEP), [zoom, setZoom]),
    zoomOut: useCallback(() => setZoom(zoom / STEP), [zoom, setZoom]),
    fit: useCallback(() => setZoom(1), [setZoom]),
  };
}

/** Ctrl (or Cmd) + mouse wheel over `ref` zooms instead of scrolling the page. */
export function useCtrlWheelZoom(ref: RefObject<HTMLElement | null>, zoom: number, setZoom: (z: number) => void) {
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      if (!e.ctrlKey && !e.metaKey) return;
      e.preventDefault();
      setZoom(zoom * (e.deltaY < 0 ? 1.1 : 1 / 1.1));
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, [ref, zoom, setZoom]);
}
