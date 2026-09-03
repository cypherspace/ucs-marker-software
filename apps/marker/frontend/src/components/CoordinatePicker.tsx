import { useRef, useState } from 'react';
import useImage from 'use-image';
import { Stage, Layer, Image as KonvaImage, Rect, Text } from 'react-konva';
import type { KonvaEventObject } from 'konva/lib/Node';
import type { ClipRegion, NameZone } from '@marker/shared-types';

type RegionType = 'question' | 'ms' | 'name_zone';

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

interface Props {
  // URL to rendered PDF page image from extractor /render endpoint
  pageImageUrl: string;
  page: number;
  existingRegions?: DrawnRegion[];
  onRegionsChange: (regions: DrawnRegion[]) => void;
  activeType: RegionType;
  activeLabel?: string;
}

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

export function CoordinatePicker({ pageImageUrl, page, existingRegions = [], onRegionsChange, activeType, activeLabel }: Props) {
  const [image] = useImage(pageImageUrl, 'anonymous');
  const [regions, setRegions] = useState<DrawnRegion[]>(existingRegions);
  const [isDrawing, setIsDrawing] = useState(false);
  const [start, setStart] = useState<{ x: number; y: number } | null>(null);
  const [preview, setPreview] = useState<{ x: number; y: number; width: number; height: number } | null>(null);

  const imgWidth = image?.width ?? 800;
  const imgHeight = image?.height ?? 1200;
  const scale = Math.min(1, 700 / imgWidth, 900 / imgHeight);
  const displayW = imgWidth * scale;
  const displayH = imgHeight * scale;

  function getPos(e: KonvaEventObject<MouseEvent>) {
    const pos = e.target.getStage()?.getPointerPosition();
    if (!pos) return null;
    return { x: pos.x / scale, y: pos.y / scale };
  }

  function handleMouseDown(e: Parameters<typeof getPos>[0]) {
    const pos = getPos(e);
    if (!pos) return;
    setIsDrawing(true);
    setStart(pos);
    setPreview({ x: pos.x, y: pos.y, width: 0, height: 0 });
  }

  function handleMouseMove(e: Parameters<typeof getPos>[0]) {
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

  function handleMouseUp(e: Parameters<typeof getPos>[0]) {
    if (!isDrawing || !start) return;
    setIsDrawing(false);
    const pos = getPos(e);
    if (!pos) return;
    const rect = {
      x: Math.min(start.x, pos.x),
      y: Math.min(start.y, pos.y),
      width: Math.abs(pos.x - start.x),
      height: Math.abs(pos.y - start.y),
    };
    if (rect.width < 10 || rect.height < 10) { setPreview(null); return; }
    const newRegion: DrawnRegion = {
      id: nanoid(),
      type: activeType,
      page,
      ...rect,
      label: activeLabel,
    };
    const next = [...regions, newRegion];
    setRegions(next);
    onRegionsChange(next);
    setPreview(null);
    setStart(null);
  }

  function removeRegion(id: string) {
    const next = regions.filter((r) => r.id !== id);
    setRegions(next);
    onRegionsChange(next);
  }

  return (
    <div className="flex gap-4">
      <div className="relative">
        <Stage
          width={displayW}
          height={displayH}
          scaleX={scale}
          scaleY={scale}
          onMouseDown={handleMouseDown}
          onMouseMove={handleMouseMove}
          onMouseUp={handleMouseUp}
          style={{ cursor: 'crosshair', border: '1px solid #e2e8f0', borderRadius: 4 }}
        >
          <Layer>
            {image && <KonvaImage image={image} x={0} y={0} width={imgWidth} height={imgHeight} />}
            {regions.filter((r) => r.page === page).map((r) => (
              <>
                <Rect
                  key={r.id}
                  x={r.x} y={r.y} width={r.width} height={r.height}
                  stroke={TYPE_COLORS[r.type]}
                  strokeWidth={2}
                  fill={TYPE_COLORS[r.type] + '20'}
                />
                <Text
                  key={r.id + '-label'}
                  x={r.x + 3} y={r.y + 3}
                  text={r.label ? `${TYPE_LABELS[r.type]}: ${r.label}` : TYPE_LABELS[r.type]}
                  fontSize={11}
                  fill={TYPE_COLORS[r.type]}
                  fontStyle="bold"
                />
              </>
            ))}
            {preview && (
              <Rect
                x={preview.x} y={preview.y} width={preview.width} height={preview.height}
                stroke={TYPE_COLORS[activeType]}
                strokeWidth={2}
                fill={TYPE_COLORS[activeType] + '15'}
                dash={[4, 3]}
              />
            )}
          </Layer>
        </Stage>
      </div>

      {/* Region list — all pages */}
      <div className="w-52 flex-shrink-0 flex flex-col gap-2">
        <div className="text-xs font-medium text-slate-500 uppercase tracking-wide">All regions</div>
        <div className="space-y-1 flex-1">
          {regions.length === 0 && (
            <div className="text-xs text-slate-400">Draw to add regions.</div>
          )}
          {[...regions].sort((a, b) => a.page - b.page || a.type.localeCompare(b.type)).map((r) => (
            <div
              key={r.id}
              className={`flex items-center justify-between rounded border px-2 py-1 text-xs ${r.page === page ? 'bg-slate-50 border-slate-200' : 'bg-white border-slate-100 opacity-60'}`}
            >
              <span style={{ color: TYPE_COLORS[r.type] }} className="font-medium truncate">
                {TYPE_LABELS[r.type]}{r.label ? `: ${r.label}` : ''}
                <span className="text-slate-400 font-normal ml-1">p.{r.page}</span>
              </span>
              <button onClick={() => removeRegion(r.id)} className="text-slate-400 hover:text-red-500 ml-2 flex-shrink-0">✕</button>
            </div>
          ))}
        </div>
        {regions.length > 0 && (
          <div className="text-xs text-slate-500 border-t border-slate-100 pt-2">
            {regions.filter(r => r.type === 'question').length}Q
            {' · '}{regions.filter(r => r.type === 'ms').length}MS
            {' · '}{regions.filter(r => r.type === 'name_zone').length}NZ
            {' across '}
            {new Set(regions.map(r => r.page)).size} page(s)
          </div>
        )}
        <div className="text-xs text-slate-400 leading-tight border-t border-slate-100 pt-2">
          <div className="flex items-center gap-1.5 mb-1">
            <span className="w-2 h-2 rounded-full bg-blue-600 inline-block" /> Question clip
          </div>
          <div className="flex items-center gap-1.5 mb-1">
            <span className="w-2 h-2 rounded-full bg-green-600 inline-block" /> Mark scheme
          </div>
          <div className="flex items-center gap-1.5">
            <span className="w-2 h-2 rounded-full bg-red-600 inline-block" /> Name zone (blacked out)
          </div>
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
