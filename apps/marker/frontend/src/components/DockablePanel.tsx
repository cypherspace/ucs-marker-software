import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent, type ReactNode } from 'react';
import { clampRect, clampSize, nearestEdge, type Edge, type Rect } from '../lib/panelGeometry';

type Mode = Edge | 'float';

interface Saved {
  mode: Mode;
  /** Thickness when docked left or right */
  w: number;
  /** Thickness when docked top or bottom */
  h: number;
  /** Position and size when floating (viewport pixels) */
  rect: Rect;
}

const DEFAULTS = (): Saved => ({
  mode: 'right',
  w: 360,
  h: 260,
  rect: { x: Math.max(0, window.innerWidth - 440), y: 120, w: 400, h: 480 },
});

function load(key: string): Saved {
  const d = DEFAULTS();
  try {
    const v = JSON.parse(window.localStorage.getItem(key) ?? 'null') as Partial<Saved> | null;
    if (!v) return d;
    const modes = ['left', 'right', 'top', 'bottom', 'float'];
    return {
      mode: modes.includes(v.mode as string) ? (v.mode as Mode) : d.mode,
      w: Number(v.w) > 0 ? Number(v.w) : d.w,
      h: Number(v.h) > 0 ? Number(v.h) : d.h,
      rect: v.rect && Number(v.rect.w) > 0 && Number(v.rect.h) > 0
        ? { x: Number(v.rect.x) || 0, y: Number(v.rect.y) || 0, w: Number(v.rect.w), h: Number(v.rect.h) }
        : d.rect,
    };
  } catch {
    return d;
  }
}

const viewport = (): Rect => ({ x: 0, y: 0, w: window.innerWidth, h: window.innerHeight });

function DockIcon({ side }: { side: Mode }) {
  // A small window with the docked side filled in; "float" is a smaller window inside a larger one
  return (
    <svg viewBox="0 0 16 14" className="h-3.5 w-4" fill="none" stroke="currentColor" strokeWidth={1.2} aria-hidden>
      <rect x="1" y="1" width="14" height="12" rx="1.5" />
      {side === 'left' && <rect x="1" y="1" width="5" height="12" fill="currentColor" />}
      {side === 'right' && <rect x="10" y="1" width="5" height="12" fill="currentColor" />}
      {side === 'top' && <rect x="1" y="1" width="14" height="4.5" fill="currentColor" />}
      {side === 'bottom' && <rect x="1" y="8.5" width="14" height="4.5" fill="currentColor" />}
      {side === 'float' && <rect x="5" y="4" width="8" height="6" fill="currentColor" />}
    </svg>
  );
}

const MODE_LABEL: Record<Mode, string> = {
  left: 'Dock on the left', right: 'Dock on the right', top: 'Dock at the top', bottom: 'Dock at the bottom', float: 'Float',
};

/**
 * Lays out `children` (the main workspace) with a side panel that can be docked to any edge,
 * dragged free as a floating window, resized and closed. Where it was left is remembered in this
 * browser. Drag the title bar toward an edge to dock it there; the buttons do the same without dragging.
 */
export function DockablePanel({
  title, storageKey, open, onClose, panel, children,
}: {
  title: string;
  storageKey: string;
  open: boolean;
  onClose: () => void;
  /** The panel's contents */
  panel: ReactNode;
  /** The main workspace the panel docks around */
  children: ReactNode;
}) {
  const [saved, setSaved] = useState<Saved>(() => load(storageKey));
  const [drag, setDrag] = useState<{ rect: Rect; snap: Edge | null; host: Rect } | null>(null);
  const hostRef = useRef<HTMLDivElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const [, bump] = useState(0);

  useEffect(() => {
    try { window.localStorage.setItem(storageKey, JSON.stringify(saved)); } catch { /* storage unavailable */ }
  }, [saved, storageKey]);

  // Keep a floating panel inside the window, and docked sizes within range, when the window resizes
  useEffect(() => {
    const onResize = () => bump((n) => n + 1);
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  const mode: Mode = drag ? 'float' : saved.mode;
  const vertical = mode === 'top' || mode === 'bottom';          // panel stacked above/below the workspace
  const panelFirst = mode === 'left' || mode === 'top';
  const floating = mode === 'float';
  const hostRect = hostRef.current?.getBoundingClientRect();
  const hostW = hostRect?.width ?? window.innerWidth;
  const hostH = hostRect?.height ?? window.innerHeight;

  const floatRect = clampRect(drag ? drag.rect : saved.rect, viewport());

  function dockTo(next: Mode) {
    setSaved((s) => ({ ...s, mode: next }));
  }

  // ── Dragging the title bar ────────────────────────────────────────────────
  function onHeaderPointerDown(e: ReactPointerEvent<HTMLDivElement>) {
    if (e.button !== 0 || (e.target as HTMLElement).closest('button')) return;
    const startX = e.clientX;
    const startY = e.clientY;
    const el = e.currentTarget;
    const panelBox = panelRef.current?.getBoundingClientRect();
    const size = floating || !panelBox ? saved.rect : { ...saved.rect, x: panelBox.x, y: panelBox.y };
    // Keep the pointer where it grabbed the title bar
    const grabX = floating ? startX - saved.rect.x : Math.min(60, saved.rect.w / 2);
    const grabY = floating ? startY - saved.rect.y : 14;
    let started = false;
    el.setPointerCapture(e.pointerId);

    const rectAt = (cx: number, cy: number): Rect => clampRect({ x: cx - grabX, y: cy - grabY, w: size.w, h: size.h }, viewport());
    const move = (ev: PointerEvent) => {
      if (!started && Math.hypot(ev.clientX - startX, ev.clientY - startY) < 6) return;
      started = true;
      const host = hostRef.current?.getBoundingClientRect();
      const bounds: Rect = host ? { x: host.x, y: host.y, w: host.width, h: host.height } : viewport();
      setDrag({ rect: rectAt(ev.clientX, ev.clientY), snap: nearestEdge({ x: ev.clientX, y: ev.clientY }, bounds), host: bounds });
    };
    const up = (ev: PointerEvent) => {
      el.releasePointerCapture(e.pointerId);
      el.removeEventListener('pointermove', move);
      el.removeEventListener('pointerup', up);
      el.removeEventListener('pointercancel', up);
      if (!started) return;
      const host = hostRef.current?.getBoundingClientRect();
      const bounds: Rect = host ? { x: host.x, y: host.y, w: host.width, h: host.height } : viewport();
      const snap = nearestEdge({ x: ev.clientX, y: ev.clientY }, bounds);
      const rect = rectAt(ev.clientX, ev.clientY);
      setDrag(null);
      setSaved((s) => (snap ? { ...s, mode: snap, rect } : { ...s, mode: 'float', rect }));
    };
    el.addEventListener('pointermove', move);
    el.addEventListener('pointerup', up);
    el.addEventListener('pointercancel', up);
  }

  // ── Resizing: the splitter when docked, the corner when floating ──────────
  function onSplitterPointerDown(e: ReactPointerEvent<HTMLDivElement>) {
    const host = hostRef.current?.getBoundingClientRect();
    if (!host) return;
    const el = e.currentTarget;
    el.setPointerCapture(e.pointerId);
    const move = (ev: PointerEvent) => {
      if (mode === 'right') setSaved((s) => ({ ...s, w: clampSize(host.right - ev.clientX, host.width) }));
      else if (mode === 'left') setSaved((s) => ({ ...s, w: clampSize(ev.clientX - host.left, host.width) }));
      else if (mode === 'bottom') setSaved((s) => ({ ...s, h: clampSize(host.bottom - ev.clientY, host.height, 120) }));
      else if (mode === 'top') setSaved((s) => ({ ...s, h: clampSize(ev.clientY - host.top, host.height, 120) }));
    };
    const up = () => {
      el.releasePointerCapture(e.pointerId);
      el.removeEventListener('pointermove', move);
      el.removeEventListener('pointerup', up);
    };
    el.addEventListener('pointermove', move);
    el.addEventListener('pointerup', up);
  }

  function onCornerPointerDown(e: ReactPointerEvent<HTMLDivElement>) {
    const el = e.currentTarget;
    el.setPointerCapture(e.pointerId);
    const move = (ev: PointerEvent) => {
      setSaved((s) => ({ ...s, rect: clampRect({ ...s.rect, w: ev.clientX - s.rect.x, h: ev.clientY - s.rect.y }, viewport()) }));
    };
    const up = () => {
      el.releasePointerCapture(e.pointerId);
      el.removeEventListener('pointermove', move);
      el.removeEventListener('pointerup', up);
    };
    el.addEventListener('pointermove', move);
    el.addEventListener('pointerup', up);
  }

  const thickness = vertical ? clampSize(saved.h, hostH, 120) : clampSize(saved.w, hostW);
  const panelStyle = floating
    ? { position: 'fixed' as const, left: floatRect.x, top: floatRect.y, width: floatRect.w, height: floatRect.h, zIndex: 40 }
    : vertical
      ? { height: thickness, order: panelFirst ? 0 : 2 }
      : { width: thickness, order: panelFirst ? 0 : 2 };

  // The shaded area showing where a dragged panel would dock
  const zone = drag?.snap ? (() => {
    const h = drag.host;
    const t = drag.snap;
    const size = t === 'left' || t === 'right' ? clampSize(saved.w, h.w) : clampSize(saved.h, h.h, 120);
    return {
      left: t === 'right' ? h.x + h.w - size : h.x,
      top: t === 'bottom' ? h.y + h.h - size : h.y,
      width: t === 'left' || t === 'right' ? size : h.w,
      height: t === 'top' || t === 'bottom' ? size : h.h,
    };
  })() : null;

  return (
    <div ref={hostRef} className={`relative flex min-h-0 min-w-0 flex-1 ${vertical ? 'flex-col' : 'flex-row'}`}>
      <div className="min-h-0 min-w-0 flex-1" style={{ order: open && panelFirst ? 2 : 0 }}>{children}</div>

      {open && !floating && (
        <div
          role="separator"
          aria-orientation={vertical ? 'horizontal' : 'vertical'}
          aria-label={`Resize ${title}`}
          onPointerDown={onSplitterPointerDown}
          className={`flex-shrink-0 touch-none bg-slate-200 hover:bg-indigo-400 ${vertical ? 'h-1.5 cursor-row-resize' : 'w-1.5 cursor-col-resize'}`}
          style={{ order: 1 }}
        />
      )}

      {open && (
        <div
          ref={panelRef}
          role="complementary"
          aria-label={title}
          className={`flex min-h-0 min-w-0 flex-shrink-0 flex-col overflow-hidden border border-amber-300 bg-amber-50 ${floating ? 'rounded-lg shadow-2xl' : ''}`}
          style={panelStyle}
        >
          <div
            onPointerDown={onHeaderPointerDown}
            className="flex flex-shrink-0 cursor-grab touch-none select-none items-center gap-1 border-b border-amber-200 bg-amber-100 px-2 py-1 active:cursor-grabbing"
          >
            <span className="flex-1 truncate text-xs font-semibold uppercase tracking-wide text-amber-800">{title}</span>
            {(['left', 'right', 'top', 'bottom', 'float'] as Mode[]).map((m) => (
              <button
                key={m}
                type="button"
                onClick={() => dockTo(m)}
                aria-label={MODE_LABEL[m]}
                aria-pressed={saved.mode === m}
                title={MODE_LABEL[m]}
                className={`rounded p-1 ${saved.mode === m ? 'bg-amber-300 text-amber-900' : 'text-amber-700 hover:bg-amber-200'}`}
              >
                <DockIcon side={m} />
              </button>
            ))}
            <button
              type="button"
              onClick={onClose}
              aria-label={`Hide ${title}`}
              title="Hide"
              className="ml-1 rounded px-1.5 text-base leading-none text-amber-800 hover:bg-amber-200"
            >
              ×
            </button>
          </div>
          <div className="min-h-0 flex-1">{panel}</div>
          {floating && (
            <div
              onPointerDown={onCornerPointerDown}
              aria-label="Resize"
              className="absolute bottom-0 right-0 h-4 w-4 cursor-nwse-resize touch-none"
              style={{ background: 'linear-gradient(135deg, transparent 50%, #d97706 50%)' }}
            />
          )}
        </div>
      )}

      {zone && (
        <div
          aria-hidden
          className="pointer-events-none fixed z-30 rounded border-2 border-dashed border-indigo-500 bg-indigo-400/20"
          style={zone}
        />
      )}
    </div>
  );
}
