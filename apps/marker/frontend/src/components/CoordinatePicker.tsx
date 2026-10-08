import { useCallback, useEffect, useRef, useState } from 'react';
import { Stage, Layer, Image as KonvaImage, Rect, Text, Transformer } from 'react-konva';
import type Konva from 'konva';
import type { KonvaEventObject } from 'konva/lib/Node';
import type { ClipRegion, NameZone } from '@marker/shared-types';
import { HttpError } from '../api';

export type RegionType = 'question' | 'ms' | 'name_zone';

export interface DrawnRegion {
  id: string;
  type: RegionType;
  page: number;
  x: number;
  y: number;
  width: number;
  height: number;
  label?: string;
}

// The extractor renders pages at RENDER_DPI; the picker works in those image
// pixels, but clip coordinates are stored in PDF points (72 DPI).
const RENDER_DPI = 150;
const PT_PER_PX = 72 / RENDER_DPI;
const toPt = (n: number) => Math.round(n * PT_PER_PX * 100) / 100;
const toPx = (n: number) => n / PT_PER_PX;

const MIN_SIZE = 10;
const MAX_HISTORY = 50;

export interface PageImage { objectUrl: string; pageCount: number | null }

interface Props {
  // Identifies the document being drawn on (a script, or the mark scheme); a new key reloads the page image
  sourceKey: string;
  // Fetches one rendered page of that document
  loadPage: (page: number) => Promise<PageImage>;
  page: number;
  // Regions to start from. Remount (change `key`) to reset for another question.
  initialRegions?: DrawnRegion[];
  onRegionsChange: (regions: DrawnRegion[]) => void;
  activeType: RegionType;
  // Called once the document's page count is known, so the caller can bound page navigation.
  onPageCount?: (count: number) => void;
  onRequestPage?: (page: number) => void;
}

type ImageState =
  | { status: 'loading' }
  | { status: 'ready'; img: HTMLImageElement }
  | { status: 'error'; message: string };

function nanoid() {
  return Math.random().toString(36).slice(2, 10);
}

const TYPE_COLORS: Record<RegionType, string> = {
  question: '#2563eb',
  ms: '#16a34a',
  name_zone: '#dc2626',
};

const TYPE_LABELS: Record<RegionType, string> = {
  question: 'Q',
  ms: 'MS',
  name_zone: 'NAME',
};

const TYPE_NAMES: Record<RegionType, string> = {
  question: 'Question',
  ms: 'Mark scheme',
  name_zone: 'Name zone',
};

function describeError(e: unknown): string {
  if (e instanceof HttpError) {
    if (e.status === 401) return 'Your session has expired. Sign in again and retry.';
    return `${e.message} (HTTP ${e.status})`;
  }
  return e instanceof Error ? e.message : 'Could not load the page.';
}

const clamp = (v: number, min: number, max: number) => Math.min(Math.max(v, min), Math.max(min, max));

export function CoordinatePicker({
  sourceKey, loadPage, page, initialRegions = [], onRegionsChange, activeType, onPageCount, onRequestPage,
}: Props) {
  const [imgState, setImgState] = useState<ImageState>({ status: 'loading' });
  const [reloadKey, setReloadKey] = useState(0);
  const [regions, setRegions] = useState<DrawnRegion[]>(initialRegions);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [isDrawing, setIsDrawing] = useState(false);
  const [start, setStart] = useState<{ x: number; y: number } | null>(null);
  const [preview, setPreview] = useState<{ x: number; y: number; width: number; height: number } | null>(null);
  const pastRef = useRef<DrawnRegion[][]>([]);
  const [historyDepth, setHistoryDepth] = useState(0);
  const shapeRefs = useRef<Record<string, Konva.Rect>>({});
  const trRef = useRef<Konva.Transformer>(null);
  const onPageCountRef = useRef(onPageCount);
  onPageCountRef.current = onPageCount;
  const loadPageRef = useRef(loadPage);
  loadPageRef.current = loadPage;

  // ── Page image ────────────────────────────────────────────────────────────
  useEffect(() => {
    let cancelled = false;
    let objectUrl: string | null = null;
    setImgState({ status: 'loading' });
    loadPageRef.current(page)
      .then(({ objectUrl: url, pageCount }) => {
        objectUrl = url;
        if (cancelled) return;
        if (pageCount) onPageCountRef.current?.(pageCount);
        const img = new window.Image();
        img.onload = () => { if (!cancelled) setImgState({ status: 'ready', img }); };
        img.onerror = () => { if (!cancelled) setImgState({ status: 'error', message: 'The page image could not be read.' }); };
        img.src = url;
      })
      .catch((e) => { if (!cancelled) setImgState({ status: 'error', message: describeError(e) }); });
    return () => {
      cancelled = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [sourceKey, page, reloadKey]);

  const image = imgState.status === 'ready' ? imgState.img : null;
  const imgWidth = image?.width ?? 800;
  const imgHeight = image?.height ?? 1200;
  const scale = Math.min(1, 700 / imgWidth, 900 / imgHeight);

  // ── Region editing (with undo history) ────────────────────────────────────
  const commit = useCallback((next: DrawnRegion[]) => {
    pastRef.current.push(regions);
    if (pastRef.current.length > MAX_HISTORY) pastRef.current.shift();
    setHistoryDepth(pastRef.current.length);
    setRegions(next);
    onRegionsChange(next);
  }, [regions, onRegionsChange]);

  const undo = useCallback(() => {
    const prev = pastRef.current.pop();
    setHistoryDepth(pastRef.current.length);
    if (!prev) return;
    setRegions(prev);
    onRegionsChange(prev);
    setSelectedId((id) => (id && prev.some((r) => r.id === id) ? id : null));
  }, [onRegionsChange]);

  const removeRegion = useCallback((id: string) => {
    commit(regions.filter((r) => r.id !== id));
    setSelectedId((cur) => (cur === id ? null : cur));
  }, [commit, regions]);

  function clearPage() {
    const onPage = regions.filter((r) => r.page === page);
    if (onPage.length === 0) return;
    if (!window.confirm(`Remove all ${onPage.length} region${onPage.length === 1 ? '' : 's'} on page ${page}?`)) return;
    commit(regions.filter((r) => r.page !== page));
    setSelectedId(null);
  }

  function clearAll() {
    if (regions.length === 0) return;
    if (!window.confirm(`Remove all ${regions.length} region${regions.length === 1 ? '' : 's'} on every page?`)) return;
    commit([]);
    setSelectedId(null);
  }

  // Keyboard: Delete removes the selected region, Ctrl/Cmd+Z undoes, Escape deselects.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable)) return;
      if ((e.key === 'Delete' || e.key === 'Backspace') && selectedId) {
        e.preventDefault();
        removeRegion(selectedId);
      } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') {
        e.preventDefault();
        undo();
      } else if (e.key === 'Escape') {
        setSelectedId(null);
      }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [selectedId, removeRegion, undo]);

  // Attach the resize handles to the selected region's shape.
  useEffect(() => {
    const tr = trRef.current;
    if (!tr) return;
    const node = selectedId ? shapeRefs.current[selectedId] : undefined;
    tr.nodes(node ? [node] : []);
    tr.getLayer()?.batchDraw();
  }, [selectedId, regions, page, imgState]);

  // ── Drawing ───────────────────────────────────────────────────────────────
  function getPos(e: KonvaEventObject<MouseEvent>) {
    const pos = e.target.getStage()?.getPointerPosition();
    if (!pos) return null;
    return { x: clamp(pos.x / scale, 0, imgWidth), y: clamp(pos.y / scale, 0, imgHeight) };
  }

  function handleMouseDown(e: KonvaEventObject<MouseEvent>) {
    const onBackground = e.target === e.target.getStage() || e.target.name() === 'bg';
    if (!onBackground) return;
    setSelectedId(null);
    const pos = getPos(e);
    if (!pos) return;
    setIsDrawing(true);
    setStart(pos);
    setPreview({ x: pos.x, y: pos.y, width: 0, height: 0 });
  }

  function handleMouseMove(e: KonvaEventObject<MouseEvent>) {
    if (!isDrawing || !start) return;
    const pos = getPos(e);
    if (!pos) return;
    setPreview({
      x: Math.min(start.x, pos.x),
      y: Math.min(start.y, pos.y),
      width: Math.abs(pos.x - start.x),
      height: Math.abs(pos.y - start.y),
    });
  }

  function handleMouseUp(e: KonvaEventObject<MouseEvent>) {
    if (!isDrawing || !start) return;
    setIsDrawing(false);
    const pos = getPos(e);
    setStart(null);
    setPreview(null);
    if (!pos) return;
    const rect = {
      x: Math.min(start.x, pos.x),
      y: Math.min(start.y, pos.y),
      width: Math.abs(pos.x - start.x),
      height: Math.abs(pos.y - start.y),
    };
    if (rect.width < MIN_SIZE || rect.height < MIN_SIZE) return;
    const region: DrawnRegion = { id: nanoid(), type: activeType, page, ...rect };
    commit([...regions, region]);
    setSelectedId(region.id);
  }

  // ── Loading / error states ────────────────────────────────────────────────
  if (imgState.status !== 'ready') {
    return (
      <div className="flex min-h-[300px] items-center justify-center rounded border border-dashed border-slate-300 bg-slate-50 p-6 text-center">
        {imgState.status === 'loading' ? (
          <div className="text-sm text-slate-500">Loading page {page}…</div>
        ) : (
          <div role="alert" className="max-w-md space-y-3">
            <div className="text-sm font-medium text-red-700">Page {page} could not be shown</div>
            <p className="text-sm text-slate-600">{imgState.message}</p>
            <button
              onClick={() => setReloadKey((k) => k + 1)}
              className="rounded-lg bg-indigo-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-indigo-700"
            >
              Try again
            </button>
          </div>
        )}
      </div>
    );
  }

  const sorted = [...regions].sort((a, b) => a.page - b.page || a.type.localeCompare(b.type));

  return (
    <div className="flex gap-4">
      <div className="relative">
        <Stage
          width={imgWidth * scale}
          height={imgHeight * scale}
          scaleX={scale}
          scaleY={scale}
          onMouseDown={handleMouseDown}
          onMouseMove={handleMouseMove}
          onMouseUp={handleMouseUp}
          style={{ cursor: 'crosshair', border: '1px solid #e2e8f0', borderRadius: 4 }}
        >
          <Layer>
            <KonvaImage name="bg" image={imgState.img} x={0} y={0} width={imgWidth} height={imgHeight} />
            {regions.filter((r) => r.page === page).map((r) => (
              <Rect
                key={r.id}
                ref={(node) => {
                  if (node) shapeRefs.current[r.id] = node;
                  else delete shapeRefs.current[r.id];
                }}
                x={r.x} y={r.y} width={r.width} height={r.height}
                stroke={TYPE_COLORS[r.type]}
                strokeWidth={r.id === selectedId ? 3 : 2}
                fill={TYPE_COLORS[r.type] + (r.id === selectedId ? '30' : '20')}
                draggable
                onMouseDown={(e) => { e.cancelBubble = true; setSelectedId(r.id); }}
                onMouseEnter={(e) => { const c = e.target.getStage()?.container(); if (c) c.style.cursor = 'move'; }}
                onMouseLeave={(e) => { const c = e.target.getStage()?.container(); if (c) c.style.cursor = 'crosshair'; }}
                onDragEnd={(e) => {
                  const n = e.target;
                  commit(regions.map((x) => x.id === r.id
                    ? { ...x, x: clamp(n.x(), 0, imgWidth - x.width), y: clamp(n.y(), 0, imgHeight - x.height) }
                    : x));
                }}
                onTransformEnd={(e) => {
                  const n = e.target as Konva.Rect;
                  const width = Math.max(MIN_SIZE, n.width() * n.scaleX());
                  const height = Math.max(MIN_SIZE, n.height() * n.scaleY());
                  n.scaleX(1);
                  n.scaleY(1);
                  commit(regions.map((x) => x.id === r.id
                    ? { ...x, width, height, x: clamp(n.x(), 0, imgWidth - width), y: clamp(n.y(), 0, imgHeight - height) }
                    : x));
                }}
              />
            ))}
            {regions.filter((r) => r.page === page).map((r) => (
              <Text
                key={`${r.id}-label`}
                x={r.x + 3} y={r.y + 3}
                text={r.label ? `${TYPE_LABELS[r.type]}: ${r.label}` : TYPE_LABELS[r.type]}
                fontSize={11}
                fill={TYPE_COLORS[r.type]}
                fontStyle="bold"
                listening={false}
              />
            ))}
            {preview && (
              <Rect
                x={preview.x} y={preview.y} width={preview.width} height={preview.height}
                stroke={TYPE_COLORS[activeType]}
                strokeWidth={2}
                fill={TYPE_COLORS[activeType] + '15'}
                dash={[4, 3]}
                listening={false}
              />
            )}
            <Transformer
              ref={trRef}
              rotateEnabled={false}
              keepRatio={false}
              ignoreStroke
              boundBoxFunc={(oldBox, newBox) => (newBox.width < MIN_SIZE || newBox.height < MIN_SIZE ? oldBox : newBox)}
            />
          </Layer>
        </Stage>
      </div>

      {/* Controls and region list — all pages */}
      <div className="flex w-56 flex-shrink-0 flex-col gap-2">
        <div className="grid grid-cols-2 gap-1 text-xs">
          <button
            onClick={undo}
            disabled={historyDepth === 0}
            title="Undo (Ctrl+Z)"
            className="rounded border border-slate-300 bg-white px-2 py-1.5 font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-40"
          >
            Undo
          </button>
          <button
            onClick={() => selectedId && removeRegion(selectedId)}
            disabled={!selectedId}
            title="Delete selected (Delete key)"
            className="rounded border border-slate-300 bg-white px-2 py-1.5 font-medium text-red-600 hover:bg-red-50 disabled:opacity-40"
          >
            Delete selected
          </button>
          <button
            onClick={clearPage}
            disabled={!regions.some((r) => r.page === page)}
            className="rounded border border-slate-300 bg-white px-2 py-1.5 font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-40"
          >
            Clear page
          </button>
          <button
            onClick={clearAll}
            disabled={regions.length === 0}
            className="rounded border border-slate-300 bg-white px-2 py-1.5 font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-40"
          >
            Clear all
          </button>
        </div>

        <div className="text-xs font-medium uppercase tracking-wide text-slate-500">All regions</div>
        <div className="flex-1 space-y-1">
          {regions.length === 0 && (
            <div className="text-xs text-slate-400">Drag on the page to draw a region.</div>
          )}
          {sorted.map((r) => (
            <div
              key={r.id}
              className={`flex items-center justify-between rounded border px-2 py-1 text-xs ${
                r.id === selectedId ? 'border-indigo-400 bg-indigo-50' : r.page === page ? 'border-slate-200 bg-slate-50' : 'border-slate-100 bg-white opacity-70'
              }`}
            >
              <button
                onClick={() => { setSelectedId(r.id); if (r.page !== page) onRequestPage?.(r.page); }}
                className="min-w-0 flex-1 truncate text-left font-medium"
                style={{ color: TYPE_COLORS[r.type] }}
                title="Select this region"
              >
                {TYPE_NAMES[r.type]}
                <span className="ml-1 font-normal text-slate-400">p.{r.page}</span>
              </button>
              <button
                onClick={() => removeRegion(r.id)}
                aria-label={`Remove ${TYPE_NAMES[r.type]} region on page ${r.page}`}
                className="ml-2 flex-shrink-0 text-slate-400 hover:text-red-500"
              >
                ✕
              </button>
            </div>
          ))}
        </div>
        {regions.length > 0 && (
          <div className="border-t border-slate-100 pt-2 text-xs text-slate-500">
            {regions.filter((r) => r.type === 'question').length}Q
            {' · '}{regions.filter((r) => r.type === 'ms').length}MS
            {' · '}{regions.filter((r) => r.type === 'name_zone').length}NZ
            {' across '}
            {new Set(regions.map((r) => r.page)).size} page(s)
          </div>
        )}
        <div className="border-t border-slate-100 pt-2 text-xs leading-tight text-slate-400">
          <div className="mb-1 flex items-center gap-1.5">
            <span className="inline-block h-2 w-2 rounded-full bg-blue-600" /> Question clip
          </div>
          <div className="mb-1 flex items-center gap-1.5">
            <span className="inline-block h-2 w-2 rounded-full bg-green-600" /> Mark scheme
          </div>
          <div className="flex items-center gap-1.5">
            <span className="inline-block h-2 w-2 rounded-full bg-red-600" /> Name zone (blacked out)
          </div>
          <div className="mt-2">Click a region to select it, then drag to move or pull a handle to resize.</div>
        </div>
      </div>
    </div>
  );
}

// Helpers to convert DrawnRegion arrays (image pixels) to the DB format (PDF points)
export function toClipRegions(regions: DrawnRegion[], type: 'question' | 'ms'): ClipRegion[] {
  return regions.filter((r) => r.type === type).map(({ page, x, y, width, height }) => ({
    page, x: toPt(x), y: toPt(y), width: toPt(width), height: toPt(height),
  }));
}

export function toNameZones(regions: DrawnRegion[]): NameZone[] {
  return regions.filter((r) => r.type === 'name_zone').map(({ page, x, y, width, height }) => ({
    page, x: toPt(x), y: toPt(y), width: toPt(width), height: toPt(height),
  }));
}

// Inverse: rebuild DrawnRegions (image pixels) from stored question regions (PDF points)
export function fromQuestionRegions(q: {
  clip_coordinates?: ClipRegion[] | null;
  ms_clip_coordinates?: ClipRegion[] | null;
  name_zones?: NameZone[] | null;
}): DrawnRegion[] {
  const mk = (type: RegionType) => (r: ClipRegion): DrawnRegion => ({
    id: nanoid(), type, page: r.page, x: toPx(r.x), y: toPx(r.y), width: toPx(r.width), height: toPx(r.height),
  });
  return [
    ...(q.clip_coordinates ?? []).map(mk('question')),
    ...(q.ms_clip_coordinates ?? []).map(mk('ms')),
    ...(q.name_zones ?? []).map(mk('name_zone')),
  ];
}
