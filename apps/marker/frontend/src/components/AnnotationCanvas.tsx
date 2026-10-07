import { useRef, useState, useCallback, useEffect } from 'react';
import { Stage, Layer, Image as KonvaImage, Line, Circle, Text, Group } from 'react-konva';
import type { KonvaEventObject } from 'konva/lib/Node';
import useImage from 'use-image';
import type { Annotation, AnnotationData, AnnotationTool } from '@marker/shared-types';

interface Props {
  clipUrl: string;
  initialData?: AnnotationData;
  onChange: (data: AnnotationData) => void;
  readOnly?: boolean;
  // The question's maximum: Mark ticks cannot add up to more than this
  maxMarkTicks?: number;
}

type Tool = AnnotationTool | 'erase';

const TOOL_LABELS: Record<Tool, string> = {
  mark_tick: '+1 Mark tick',
  tick: '✓ Tick',
  cross: '✗ Cross',
  numbered_tick: '#✓ Numbered Tick',
  numbered_cross: '#✗ Numbered Cross',
  circle: '○ Circle',
  underline: '― Underline',
  ruler: '╱ Ruler',
  text: 'T Text',
  erase: '⌫ Erase',
};

const COLORS = ['#16a34a', '#dc2626', '#2563eb', '#d97706', '#7c3aed', '#000000'];

// Mark ticks always look the same, so they cannot be confused with an ordinary tick
const MARK_COLOR = '#4f46e5';

// How many marks a set of annotations is worth: one per Mark tick
export function markTickTotal(data: AnnotationData | null | undefined): number {
  return (data?.annotations ?? []).filter((a) => a.type === 'mark_tick').length;
}

function nanoid() {
  return Math.random().toString(36).slice(2, 10);
}

function TickShape({ x, y, color, size = 20 }: { x: number; y: number; color: string; size?: number }) {
  const s = size;
  return (
    <Line
      points={[x - s * 0.5, y, x - s * 0.1, y + s * 0.4, x + s * 0.5, y - s * 0.4]}
      stroke={color}
      strokeWidth={3}
      lineCap="round"
      lineJoin="round"
    />
  );
}

function CrossShape({ x, y, color, size = 16 }: { x: number; y: number; color: string; size?: number }) {
  const s = size / 2;
  return (
    <>
      <Line points={[x - s, y - s, x + s, y + s]} stroke={color} strokeWidth={3} lineCap="round" />
      <Line points={[x + s, y - s, x - s, y + s]} stroke={color} strokeWidth={3} lineCap="round" />
    </>
  );
}

function MarkTickShape({ x, y }: { x: number; y: number }) {
  return (
    <>
      <Circle x={x} y={y} radius={13} fill={MARK_COLOR} stroke="#ffffff" strokeWidth={2} />
      <Line points={[x - 6, y, x - 2, y + 5, x + 7, y - 5]} stroke="#ffffff" strokeWidth={3} lineCap="round" lineJoin="round" />
      <Text text="+1" x={x + 15} y={y - 9} fontSize={14} fontStyle="bold" fill={MARK_COLOR} />
    </>
  );
}

function renderAnnotation(ann: Annotation) {
  switch (ann.type) {
    case 'mark_tick':
      return <MarkTickShape x={ann.x} y={ann.y} />;
    case 'tick':
      return <TickShape x={ann.x} y={ann.y} color={ann.color} />;
    case 'cross':
      return <CrossShape x={ann.x} y={ann.y} color={ann.color} />;
    case 'numbered_tick':
      return (
        <>
          <TickShape x={ann.x} y={ann.y} color={ann.color} />
          <Text text={String(ann.number ?? '')} x={ann.x + 14} y={ann.y - 20} fontSize={12} fill={ann.color} fontStyle="bold" />
        </>
      );
    case 'numbered_cross':
      return (
        <>
          <CrossShape x={ann.x} y={ann.y} color={ann.color} />
          <Text text={String(ann.number ?? '')} x={ann.x + 14} y={ann.y - 20} fontSize={12} fill={ann.color} fontStyle="bold" />
        </>
      );
    case 'circle':
      return (
        <Circle x={ann.x} y={ann.y} radius={ann.radius ?? 20}
          stroke={ann.color} strokeWidth={2.5} fill="transparent" />
      );
    case 'underline':
    case 'ruler':
      return ann.points ? (
        <Line points={ann.points} stroke={ann.color} strokeWidth={ann.type === 'ruler' ? 1.5 : 3}
          hitStrokeWidth={14} dash={ann.type === 'ruler' ? [6, 3] : undefined} lineCap="round" />
      ) : null;
    case 'text':
      return (
        <Text text={ann.text ?? ''} x={ann.x} y={ann.y}
          fontSize={14} fill={ann.color} fontFamily="system-ui" />
      );
    default:
      return null;
  }
}

export function AnnotationCanvas({ clipUrl, initialData, onChange, readOnly = false, maxMarkTicks }: Props) {
  const [retry, setRetry] = useState(0);
  const [image, imageStatus] = useImage(retry ? `${clipUrl}${clipUrl.includes('?') ? '&' : '?'}r=${retry}` : clipUrl, 'anonymous');
  const [annotations, setAnnotations] = useState<Annotation[]>(initialData?.annotations ?? []);
  const [tool, setTool] = useState<Tool>('mark_tick');
  const [color, setColor] = useState(COLORS[0]);
  const [isDrawing, setIsDrawing] = useState(false);
  const [drawStart, setDrawStart] = useState<{ x: number; y: number } | null>(null);
  const [currentPoints, setCurrentPoints] = useState<number[]>([]);
  const [pendingText, setPendingText] = useState<{ x: number; y: number } | null>(null);
  const [textInput, setTextInput] = useState('');
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number } | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const counterRef = useRef(
    1 + Math.max(0, ...(initialData?.annotations ?? []).map((a) => a.number ?? 0)),
  );
  const stageRef = useRef<{ container: () => HTMLElement } | null>(null);

  const imgWidth = image?.width ?? 800;
  const imgHeight = image?.height ?? 600;
  const scale = Math.min(1, 900 / imgWidth);
  const displayW = imgWidth * scale;
  const displayH = imgHeight * scale;
  const markTicks = annotations.filter((a) => a.type === 'mark_tick').length;

  const notify = useCallback((anns: Annotation[]) => {
    onChange({ annotations: anns });
  }, [onChange]);

  useEffect(() => {
    if (!notice) return;
    const t = setTimeout(() => setNotice(null), 3500);
    return () => clearTimeout(t);
  }, [notice]);

  function addAnnotation(ann: Annotation) {
    const next = [...annotations, ann];
    setAnnotations(next);
    notify(next);
  }

  function removeLastAnnotation() {
    const next = annotations.slice(0, -1);
    setAnnotations(next);
    notify(next);
  }

  function removeById(id: string) {
    const next = annotations.filter((a) => a.id !== id);
    setAnnotations(next);
    notify(next);
  }

  function getPointer(e: KonvaEventObject<MouseEvent>) {
    const pos = e.target.getStage()?.getPointerPosition();
    if (!pos) return null;
    return { x: pos.x / scale, y: pos.y / scale };
  }

  function handleDblClick(e: Parameters<typeof getPointer>[0]) {
    if (readOnly) return;
    const pos = getPointer(e);
    if (!pos) return;
    if (tool === 'tick' || tool === 'numbered_tick') {
      const ann: Annotation = {
        id: nanoid(), type: tool, x: pos.x, y: pos.y, color,
        ...(tool === 'numbered_tick' ? { number: counterRef.current++ } : {}),
      };
      addAnnotation(ann);
    }
  }

  function handleMouseDown(e: Parameters<typeof getPointer>[0]) {
    if (readOnly) return;
    const pos = getPointer(e);
    if (!pos) return;
    if (tool === 'mark_tick') {
      if (maxMarkTicks !== undefined && markTicks >= maxMarkTicks) {
        setNotice(`This question is only worth ${maxMarkTicks} mark${maxMarkTicks === 1 ? '' : 's'}.`);
        return;
      }
      addAnnotation({ id: nanoid(), type: 'mark_tick', x: pos.x, y: pos.y, color: MARK_COLOR });
    } else if (tool === 'cross' || tool === 'numbered_cross') {
      const ann: Annotation = {
        id: nanoid(), type: tool, x: pos.x, y: pos.y, color,
        ...(tool === 'numbered_cross' ? { number: counterRef.current++ } : {}),
      };
      addAnnotation(ann);
    } else if (tool === 'circle') {
      setIsDrawing(true);
      setDrawStart(pos);
    } else if (tool === 'underline' || tool === 'ruler') {
      setIsDrawing(true);
      setDrawStart(pos);
      setCurrentPoints([pos.x, pos.y, pos.x, pos.y]);
    } else if (tool === 'text') {
      setPendingText(pos);
      setTextInput('');
    }
  }

  function handleMouseMove(e: Parameters<typeof getPointer>[0]) {
    if (!isDrawing || readOnly) return;
    const pos = getPointer(e);
    if (!pos || !drawStart) return;
    if (tool === 'underline' || tool === 'ruler') {
      setCurrentPoints([drawStart.x, drawStart.y, pos.x, pos.y]);
    }
  }

  function handleMouseUp(e: Parameters<typeof getPointer>[0]) {
    if (!isDrawing || readOnly) return;
    const pos = getPointer(e);
    setIsDrawing(false);
    if (!pos || !drawStart) return;
    if (tool === 'circle') {
      const radius = Math.sqrt((pos.x - drawStart.x) ** 2 + (pos.y - drawStart.y) ** 2);
      if (radius > 5) {
        addAnnotation({ id: nanoid(), type: 'circle', x: drawStart.x, y: drawStart.y, color, radius });
      }
    } else if (tool === 'underline' || tool === 'ruler') {
      const points = [drawStart.x, drawStart.y, pos.x, pos.y];
      const dist = Math.sqrt((pos.x - drawStart.x) ** 2 + (pos.y - drawStart.y) ** 2);
      if (dist > 5) {
        addAnnotation({ id: nanoid(), type: tool, x: drawStart.x, y: drawStart.y, color, points });
      }
    }
    setDrawStart(null);
    setCurrentPoints([]);
  }

  function handleContextMenu(e: React.MouseEvent) {
    e.preventDefault();
    setContextMenu({ x: e.clientX, y: e.clientY });
  }

  function handleTextSubmit() {
    if (!pendingText || !textInput.trim()) { setPendingText(null); return; }
    addAnnotation({ id: nanoid(), type: 'text', x: pendingText.x, y: pendingText.y, color, text: textInput.trim() });
    setPendingText(null);
    setTextInput('');
  }

  // Close context menu on click outside
  useEffect(() => {
    const handler = () => setContextMenu(null);
    window.addEventListener('click', handler);
    return () => window.removeEventListener('click', handler);
  }, []);

  const tools = Object.keys(TOOL_LABELS) as Tool[];

  return (
    <div className="flex gap-4">
      {/* Toolbar */}
      {!readOnly && (
        <div className="flex w-40 flex-shrink-0 flex-col gap-2">
          <div className="text-xs font-medium text-slate-500 uppercase tracking-wide">Tool</div>
          {tools.map((t) => (
            <button
              key={t}
              onClick={() => setTool(t)}
              className={`rounded px-2 py-1.5 text-left text-xs font-medium transition-colors ${
                tool === t
                  ? 'bg-indigo-600 text-white'
                  : t === 'mark_tick'
                    ? 'bg-indigo-50 text-indigo-700 ring-1 ring-indigo-200 hover:bg-indigo-100'
                    : 'bg-slate-100 text-slate-700 hover:bg-slate-200'
              }`}
            >
              {TOOL_LABELS[t]}
            </button>
          ))}

          <div className="mt-3 text-xs font-medium text-slate-500 uppercase tracking-wide">Colour</div>
          <div className="flex flex-wrap gap-1.5">
            {COLORS.map((c) => (
              <button
                key={c}
                onClick={() => setColor(c)}
                aria-label={`Colour ${c}`}
                style={{ background: c }}
                className={`h-6 w-6 rounded-full border-2 transition-all ${color === c ? 'border-slate-700 scale-110' : 'border-transparent'}`}
              />
            ))}
          </div>

          <div className="mt-3 border-t border-slate-200 pt-3">
            <button
              onClick={removeLastAnnotation}
              disabled={annotations.length === 0}
              className="w-full rounded px-2 py-1.5 text-xs text-slate-600 bg-slate-100 hover:bg-red-50 hover:text-red-600 disabled:opacity-40"
            >
              Undo last
            </button>
          </div>

          <div className="text-xs text-slate-400 mt-2 leading-tight">
            <strong>Click</strong> to place a mark tick.<br />
            <strong>Dbl-click</strong> to place a tick/cross.<br />
            <strong>Right-click</strong> to change tool.
          </div>
        </div>
      )}

      {/* Canvas */}
      <div className="relative" onContextMenu={handleContextMenu}>
        {imageStatus === 'failed' && (
          <div role="alert" className="mb-2 flex items-center gap-3 rounded border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
            The clip image could not be loaded.
            <button onClick={() => setRetry((n) => n + 1)} className="rounded bg-red-600 px-2 py-1 text-xs font-medium text-white hover:bg-red-700">
              Try again
            </button>
          </div>
        )}
        {imageStatus === 'loading' && <div className="mb-2 text-sm text-slate-500">Loading clip…</div>}
        {notice && (
          <div role="status" className="absolute left-2 top-2 z-10 rounded bg-amber-100 px-2.5 py-1 text-xs font-medium text-amber-800 shadow">
            {notice}
          </div>
        )}
        <Stage
          ref={stageRef as Parameters<typeof Stage>[0]['ref']}
          width={displayW}
          height={displayH}
          scaleX={scale}
          scaleY={scale}
          onMouseDown={handleMouseDown}
          onMouseMove={handleMouseMove}
          onMouseUp={handleMouseUp}
          onDblClick={handleDblClick}
          style={{ cursor: readOnly ? 'default' : tool === 'erase' ? 'not-allowed' : 'crosshair', border: '1px solid #e2e8f0', borderRadius: 4 }}
        >
          <Layer>
            {image && <KonvaImage image={image} x={0} y={0} width={imgWidth} height={imgHeight} />}
            {annotations.map((ann) => (
              <Group
                key={ann.id}
                onMouseDown={!readOnly && tool === 'erase' ? (e) => { e.cancelBubble = true; removeById(ann.id); } : undefined}
              >
                {renderAnnotation(ann)}
              </Group>
            ))}
            {/* Live preview while drawing */}
            {isDrawing && (tool === 'underline' || tool === 'ruler') && currentPoints.length === 4 && (
              <Line points={currentPoints} stroke={color} strokeWidth={tool === 'ruler' ? 1.5 : 3}
                dash={tool === 'ruler' ? [6, 3] : undefined} lineCap="round" opacity={0.6} />
            )}
            {isDrawing && tool === 'circle' && drawStart && currentPoints.length === 0 && (
              <Circle x={drawStart.x} y={drawStart.y} radius={20} stroke={color} strokeWidth={2.5} fill="transparent" opacity={0.4} />
            )}
          </Layer>
        </Stage>

        {/* Text input overlay */}
        {pendingText && (
          <div
            className="absolute"
            style={{ left: pendingText.x * scale, top: pendingText.y * scale, zIndex: 10 }}
          >
            <input
              autoFocus
              value={textInput}
              onChange={(e) => setTextInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') handleTextSubmit();
                if (e.key === 'Escape') setPendingText(null);
              }}
              onBlur={handleTextSubmit}
              className="rounded border border-indigo-400 bg-white px-1 py-0.5 text-sm shadow focus:outline-none"
              placeholder="Type annotation…"
            />
          </div>
        )}

        {/* Context menu */}
        {contextMenu && !readOnly && (
          <div
            className="fixed z-50 rounded-lg border border-slate-200 bg-white py-1 shadow-lg text-sm"
            style={{ left: contextMenu.x, top: contextMenu.y }}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="px-3 py-1 text-xs font-medium text-slate-400 uppercase">Switch tool</div>
            {tools.map((t) => (
              <button
                key={t}
                onClick={() => { setTool(t); setContextMenu(null); }}
                className={`block w-full px-4 py-1.5 text-left hover:bg-slate-50 ${tool === t ? 'text-indigo-600 font-medium' : 'text-slate-700'}`}
              >
                {TOOL_LABELS[t]}
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
