const btn =
  'flex h-8 min-w-8 items-center justify-center rounded px-2 text-sm font-medium text-slate-700 hover:bg-slate-200 ' +
  'disabled:opacity-40 disabled:hover:bg-transparent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500';

/** Zoom out, the current zoom, zoom in, and back to fit-to-width. */
export function ZoomControls({
  zoom, onZoomIn, onZoomOut, onFit, label = 'Zoom',
}: { zoom: number; onZoomIn: () => void; onZoomOut: () => void; onFit: () => void; label?: string }) {
  return (
    <div role="group" aria-label={label} className="flex items-center rounded-lg bg-slate-100 p-0.5">
      <button type="button" className={btn} onClick={onZoomOut} aria-label={`${label} out`} title="Zoom out">−</button>
      <span className="w-12 text-center text-xs tabular-nums text-slate-600" aria-live="polite">{Math.round(zoom * 100)}%</span>
      <button type="button" className={btn} onClick={onZoomIn} aria-label={`${label} in`} title="Zoom in">+</button>
      <button type="button" className={btn} onClick={onFit} title="Fit to width (Ctrl + scroll also zooms)">Fit</button>
    </div>
  );
}
