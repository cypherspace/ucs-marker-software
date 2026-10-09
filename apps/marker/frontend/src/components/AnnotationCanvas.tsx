import { useRef, useState, useEffect } from 'react';
import { Stage, Layer, Image as KonvaImage, Line, Circle, Text, Group } from 'react-konva';
import type { KonvaEventObject } from 'konva/lib/Node';
import useImage from 'use-image';
import type { Annotation } from '@marker/shared-types';
import { MARK_COLOR, TOOL_LABELS, TOOLS, type Tool } from './AnnotationToolbar';
import { findPointAt, isPointType } from '../lib/annotations';
import { useElementWidth } from '../hooks/useElementWidth';
import { useCtrlWheelZoom } from '../hooks/useZoom';

// The drawing surface: shows an image with annotations over it. It owns no annotation state,
// the parent does, so the script and the converted-handwriting view share one set of tools.
interface Props {
  imageUrl: string;
  /** The annotations to draw on this image */
  annotations: Annotation[];
  tool: Tool;
  color: string;
  /** Multiple of "fit to the pane's width"; 1 = fit */
  zoom: number;
  onZoom: (zoom: number) => void;
  onTool: (tool: Tool) => void;
  onAdd: (ann: Annotation) => void;
  onRemove: (id: string) => void;
  nextNumber: () => number;
  readOnly?: boolean;
  // Mark ticks on every view added together, against the question's maximum
  markTickCount: number;
  maxMarkTicks?: number;
}

type PointerEvt = KonvaEventObject<MouseEvent | TouchEvent>;

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

export function AnnotationCanvas({
  imageUrl, annotations, tool, color, zoom, onZoom, onTool, onAdd, onRemove, nextNumber,
  readOnly = false, markTickCount, maxMarkTicks,
}: Props) {
  const [retry, setRetry] = useState(0);
  const [image, imageStatus] = useImage(retry ? `${imageUrl}${imageUrl.includes('?') ? '&' : '?'}r=${retry}` : imageUrl, 'anonymous');
  const [isDrawing, setIsDrawing] = useState(false);
  const [drawStart, setDrawStart] = useState<{ x: number; y: number } | null>(null);
  const [currentPoints, setCurrentPoints] = useState<number[]>([]);
  const [pendingText, setPendingText] = useState<{ x: number; y: number } | null>(null);
  const [textInput, setTextInput] = useState('');
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number } | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const paneRef = useRef<HTMLDivElement>(null);

  const paneWidth = useElementWidth(paneRef);
  const imgWidth = image?.width ?? 800;
  const imgHeight = image?.height ?? 600;
  // "Fit" is the pane's width (less the border and a little breathing room), never blown up past 2x
  const fitScale = paneWidth > 0 ? Math.min(2, Math.max(0.1, (paneWidth - 24) / imgWidth)) : Math.min(1, 900 / imgWidth);
  const scale = fitScale * zoom;
  const displayW = imgWidth * scale;
  const displayH = imgHeight * scale;

  useCtrlWheelZoom(paneRef, zoom, onZoom);

  useEffect(() => {
    if (!notice) return;
    const t = setTimeout(() => setNotice(null), 3500);
    return () => clearTimeout(t);
  }, [notice]);

  // Close context menu on click outside
  useEffect(() => {
    const handler = () => setContextMenu(null);
    window.addEventListener('click', handler);
    return () => window.removeEventListener('click', handler);
  }, []);

  function getPointer(e: PointerEvt) {
    const pos = e.target.getStage()?.getPointerPosition();
    if (!pos) return null;
    return { x: pos.x / scale, y: pos.y / scale };
  }

  // Ticks, crosses and mark ticks are placed with a double-click (double-tap on a tablet), and a
  // double-click on one removes it, so a stray click never changes a mark.
  function handleDblClick(e: PointerEvt) {
    if (readOnly || !isPointType(tool)) return;
    const pos = getPointer(e);
    if (!pos) return;
    const hit = findPointAt(annotations, pos.x, pos.y);
    if (hit) {
      onRemove(hit.id);
      return;
    }
    if (tool === 'mark_tick') {
      if (maxMarkTicks !== undefined && markTickCount >= maxMarkTicks) {
        setNotice(`This question is only worth ${maxMarkTicks} mark${maxMarkTicks === 1 ? '' : 's'}.`);
        return;
      }
      onAdd({ id: nanoid(), type: 'mark_tick', x: pos.x, y: pos.y, color: MARK_COLOR });
      return;
    }
    onAdd({
      id: nanoid(), type: tool as Annotation['type'], x: pos.x, y: pos.y, color,
      ...(tool === 'numbered_tick' || tool === 'numbered_cross' ? { number: nextNumber() } : {}),
    });
  }

  function handleMouseDown(e: PointerEvt) {
    if (readOnly) return;
    const pos = getPointer(e);
    if (!pos) return;
    if (tool === 'circle') {
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

  function handleMouseMove(e: PointerEvt) {
    if (!isDrawing || readOnly) return;
    const pos = getPointer(e);
    if (!pos || !drawStart) return;
    if (tool === 'underline' || tool === 'ruler') {
      setCurrentPoints([drawStart.x, drawStart.y, pos.x, pos.y]);
    }
  }

  function handleMouseUp(e: PointerEvt) {
    if (!isDrawing || readOnly) return;
    const pos = getPointer(e);
    setIsDrawing(false);
    if (!pos || !drawStart) return;
    if (tool === 'circle') {
      const radius = Math.sqrt((pos.x - drawStart.x) ** 2 + (pos.y - drawStart.y) ** 2);
      if (radius > 5) {
        onAdd({ id: nanoid(), type: 'circle', x: drawStart.x, y: drawStart.y, color, radius });
      }
    } else if (tool === 'underline' || tool === 'ruler') {
      const points = [drawStart.x, drawStart.y, pos.x, pos.y];
      const dist = Math.sqrt((pos.x - drawStart.x) ** 2 + (pos.y - drawStart.y) ** 2);
      if (dist > 5) {
        onAdd({ id: nanoid(), type: tool, x: drawStart.x, y: drawStart.y, color, points });
      }
    }
    setDrawStart(null);
    setCurrentPoints([]);
  }

  function handleContextMenu(e: React.MouseEvent) {
    e.preventDefault();
    if (!readOnly) setContextMenu({ x: e.clientX, y: e.clientY });
  }

  function handleTextSubmit() {
    if (!pendingText || !textInput.trim()) { setPendingText(null); return; }
    onAdd({ id: nanoid(), type: 'text', x: pendingText.x, y: pendingText.y, color, text: textInput.trim() });
    setPendingText(null);
    setTextInput('');
  }

  return (
    <div className="relative h-full min-w-0 flex-1">
      {notice && (
        <div role="status" className="absolute left-2 top-2 z-10 rounded bg-amber-100 px-2.5 py-1 text-xs font-medium text-amber-800 shadow">
          {notice}
        </div>
      )}
      <div ref={paneRef} className="h-full select-none overflow-auto" onContextMenu={handleContextMenu}>
        {imageStatus === 'failed' && (
          <div role="alert" className="mb-2 flex items-center gap-3 rounded border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
            The image could not be loaded.
            <button onClick={() => setRetry((n) => n + 1)} className="rounded bg-red-600 px-2 py-1 text-xs font-medium text-white hover:bg-red-700">
              Try again
            </button>
          </div>
        )}
        {imageStatus === 'loading' && <div className="mb-2 text-sm text-slate-500">Loading…</div>}
        <div className="relative inline-block align-top">
          <Stage
            width={displayW}
            height={displayH}
            scaleX={scale}
            scaleY={scale}
            onMouseDown={handleMouseDown}
            onMouseMove={handleMouseMove}
            onMouseUp={handleMouseUp}
            onDblClick={handleDblClick}
            onDblTap={handleDblClick}
            style={{ cursor: readOnly ? 'default' : tool === 'erase' ? 'not-allowed' : 'crosshair', border: '1px solid #e2e8f0', borderRadius: 4 }}
          >
            <Layer>
              {image && <KonvaImage image={image} x={0} y={0} width={imgWidth} height={imgHeight} />}
              {annotations.map((ann) => (
                <Group
                  key={ann.id}
                  onMouseDown={!readOnly && tool === 'erase' ? (e) => { e.cancelBubble = true; onRemove(ann.id); } : undefined}
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
            <div className="absolute" style={{ left: pendingText.x * scale, top: pendingText.y * scale, zIndex: 10 }}>
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
        </div>
      </div>

      {/* Context menu */}
      {contextMenu && !readOnly && (
        <div
          className="fixed z-50 rounded-lg border border-slate-200 bg-white py-1 text-sm shadow-lg"
          style={{ left: contextMenu.x, top: contextMenu.y }}
          onClick={(e) => e.stopPropagation()}
        >
          <div className="px-3 py-1 text-xs font-medium uppercase text-slate-400">Switch tool</div>
          {TOOLS.map((t) => (
            <button
              key={t}
              onClick={() => { onTool(t); setContextMenu(null); }}
              className={`block w-full px-4 py-1.5 text-left hover:bg-slate-50 ${tool === t ? 'font-medium text-indigo-600' : 'text-slate-700'}`}
            >
              {TOOL_LABELS[t]}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
