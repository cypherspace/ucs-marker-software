import { useEffect, useRef, useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { Stage, Layer, Image as KonvaImage, Line, Circle, Group } from 'react-konva';
import type { KonvaEventObject } from 'konva/lib/Node';
import { api } from '../api';
import { useElementWidth } from '../hooks/useElementWidth';
import { useZoom } from '../hooks/useZoom';
import { useClipImage } from '../lib/clipImageCache';
import { Button } from './ui';
import { ZoomControls } from './ZoomControls';
import { OverlayShapeView } from './AnnotationCanvas';
import type { OverlayData, OverlayShape } from '@marker/shared-types';

type DrawTool = 'pen' | 'line' | 'circle' | 'text' | 'erase' | 'moveDrawing' | 'moveAnswer';
const TOOL_LABEL: Record<DrawTool, string> = {
  pen: 'Pen', line: 'Line', circle: 'Circle', text: 'Text', erase: 'Erase', moveDrawing: 'Move drawing', moveAnswer: 'Move answer',
};
const MOVE_TOOLS: DrawTool[] = ['moveDrawing', 'moveAnswer'];

// The same shape, shifted: used to slide everything drawn so far into line with the answer
function shifted(sh: OverlayShape, dx: number, dy: number): OverlayShape {
  const r = (v: number) => Math.round(v * 10) / 10;
  switch (sh.type) {
    case 'pen': return { ...sh, points: sh.points.map((v, i) => r(v + (i % 2 === 0 ? dx : dy))) };
    case 'line': return { ...sh, points: sh.points.map((v, i) => r(v + (i % 2 === 0 ? dx : dy))) as [number, number, number, number] };
    case 'circle': return { ...sh, x: r(sh.x + dx), y: r(sh.y + dy) };
    case 'text': return { ...sh, x: r(sh.x + dx), y: r(sh.y + dy) };
  }
}
const SIZES: [string, number][] = [['Thin', 2], ['Medium', 4], ['Thick', 8]];
const DRAW_COLOR = '#e11d48';

// Draw the overlay: pick a candidate's answer to trace, and draw the correct graph or picture over it with the pen, lines,
// circles and text. The overlay is saved as shapes (not a picture), so it stays sharp at any size when it is turned or resized.
export function OverlayEditor({ examId, questionId, questionLabel, clips, startClipId, existing, onClose, onSaved }: {
  examId: string;
  questionId: string;
  questionLabel: string;
  clips: { id: string }[];
  startClipId: string;
  existing: OverlayData | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [clipId, setClipId] = useState(startClipId);
  const [shapes, setShapes] = useState<OverlayShape[]>(existing?.shapes ?? []);
  // Earlier versions of the drawing, for Undo (adding, erasing, clearing and moving the drawing all count)
  const [undo, setUndo] = useState<OverlayShape[][]>([]);
  const change = (next: OverlayShape[]) => { setUndo((u) => [...u.slice(-49), shapes]); setShapes(next); };
  // The answer picture can be slid about under the drawing (it is only a guide and is not saved)
  const [bg, setBg] = useState({ x: 0, y: 0 });
  // A drag in progress with Move drawing / Move answer
  const [drag, setDrag] = useState({ dx: 0, dy: 0 });
  const [tool, setTool] = useState<DrawTool>('pen');
  const [size, setSize] = useState(4);
  const [showPicture, setShowPicture] = useState(true);
  const [draft, setDraft] = useState<OverlayShape | null>(null);
  const [text, setText] = useState<{ x: number; y: number; value: string } | null>(null);
  const start = useRef<{ x: number; y: number } | null>(null);
  const paneRef = useRef<HTMLDivElement>(null);
  const zoomState = useZoom('marker.zoom.overlay');

  const [image] = useClipImage(`/api/v1/clips/${clipId}/image`);
  const paneWidth = useElementWidth(paneRef);
  const imgW = image?.width ?? existing?.width ?? 800;
  const imgH = image?.height ?? existing?.height ?? 600;
  const fit = paneWidth > 0 ? Math.min(2, Math.max(0.1, (paneWidth - 24) / imgW)) : 0.5;
  const scale = fit * zoomState.zoom;

  const save = useMutation({
    mutationFn: () => api.saveOverlay(examId, questionId, { width: imgW, height: imgH, shapes }),
    onSuccess: () => onSaved(),
  });

  const point = (e: KonvaEventObject<MouseEvent | TouchEvent>) => {
    const p = e.target.getStage()?.getPointerPosition();
    return p ? { x: Math.round((p.x / scale) * 10) / 10, y: Math.round((p.y / scale) * 10) / 10 } : null;
  };

  function down(e: KonvaEventObject<MouseEvent | TouchEvent>) {
    if (tool === 'erase') return;
    const p = point(e);
    if (!p) return;
    start.current = p;
    if (MOVE_TOOLS.includes(tool)) return;
    if (tool === 'pen') setDraft({ type: 'pen', points: [p.x, p.y], w: size });
  }

  function move(e: KonvaEventObject<MouseEvent | TouchEvent>) {
    const s0 = start.current;
    const p = point(e);
    if (!s0 || !p) return;
    if (MOVE_TOOLS.includes(tool)) { setDrag({ dx: p.x - s0.x, dy: p.y - s0.y }); return; }
    if (tool === 'pen') {
      setDraft((d) => {
        if (!d || d.type !== 'pen') return d;
        const lx = d.points[d.points.length - 2], ly = d.points[d.points.length - 1];
        // Skip points that are almost on top of the last one, so a stroke stays small
        return Math.hypot(p.x - lx, p.y - ly) < 1.5 / scale ? d : { ...d, points: [...d.points, p.x, p.y] };
      });
    } else if (tool === 'line') {
      setDraft({ type: 'line', points: [s0.x, s0.y, p.x, p.y], w: size });
    } else if (tool === 'circle') {
      setDraft({ type: 'circle', x: s0.x, y: s0.y, r: Math.max(0.5, Math.hypot(p.x - s0.x, p.y - s0.y)), w: size });
    }
  }

  function up() {
    const s0 = start.current;
    start.current = null;
    // The note box opens on mouse-up: opened on mouse-down, the browser's own focus change would close it at once
    if (tool === 'text' && s0) { setText({ ...s0, value: '' }); return; }
    if (MOVE_TOOLS.includes(tool)) { commitMove(drag.dx, drag.dy); setDrag({ dx: 0, dy: 0 }); return; }
    if (!draft) return;
    const tooSmall = (draft.type === 'pen' && draft.points.length < 4)
      || (draft.type === 'line' && Math.hypot(draft.points[2] - draft.points[0], draft.points[3] - draft.points[1]) < 3)
      || (draft.type === 'circle' && draft.r < 3);
    if (!tooSmall) change([...shapes, draft]);
    setDraft(null);
  }

  function commitMove(dx: number, dy: number) {
    if (Math.abs(dx) < 0.5 && Math.abs(dy) < 0.5) return;
    if (tool === 'moveAnswer') setBg((b) => ({ x: b.x + dx, y: b.y + dy }));
    else if (shapes.length) change(shapes.map((sh) => shifted(sh, dx, dy)));
  }

  // With a Move tool chosen, the arrow keys nudge too (Shift for bigger steps)
  useEffect(() => {
    if (!MOVE_TOOLS.includes(tool) || text) return;
    const onKey = (e: KeyboardEvent) => {
      const step = e.shiftKey ? 10 : 1;
      const d: Record<string, [number, number]> = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] };
      const m = d[e.key];
      if (!m) return;
      e.preventDefault();
      commitMove(m[0], m[1]);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  function addText() {
    if (text && text.value.trim()) change([...shapes, { type: 'text', x: text.x, y: text.y, text: text.value.trim(), size: 14 + size * 3 }]);
    setText(null);
  }

  const eraseProps = (i: number) => (tool === 'erase'
    ? { onMouseDown: (e: KonvaEventObject<MouseEvent>) => { e.cancelBubble = true; change(shapes.filter((_, j) => j !== i)); }, onTap: () => change(shapes.filter((_, j) => j !== i)) }
    : {});

  const btn = (active: boolean) => `rounded px-3 py-1.5 text-sm font-medium ${active ? 'bg-indigo-600 text-white' : 'bg-slate-100 text-slate-700 hover:bg-slate-200'}`;

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-white" role="dialog" aria-label={`Draw the overlay for Q${questionLabel}`}>
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2 border-b border-slate-200 px-4 py-2">
        <h2 className="font-semibold text-slate-800">Overlay for Q{questionLabel}</h2>
        <label className="flex items-center gap-1.5 text-sm text-slate-600">
          Trace over
          <select value={clipId} onChange={(e) => setClipId(e.target.value)} className="rounded border border-slate-300 bg-white px-2 py-1 text-sm">
            {clips.map((c, i) => <option key={c.id} value={c.id}>Script {i + 1}</option>)}
          </select>
        </label>
        <div role="group" aria-label="Drawing tools" className="flex flex-wrap gap-1">
          {(Object.keys(TOOL_LABEL) as DrawTool[]).map((t) => (
            <button key={t} type="button" aria-pressed={tool === t} className={btn(tool === t)} onClick={() => { setTool(t); setText(null); }}>{TOOL_LABEL[t]}</button>
          ))}
        </div>
        <label className="flex items-center gap-1.5 text-sm text-slate-600">
          Stroke
          <select value={size} onChange={(e) => setSize(Number(e.target.value))} className="rounded border border-slate-300 bg-white px-2 py-1 text-sm">
            {SIZES.map(([label, v]) => <option key={v} value={v}>{label}</option>)}
          </select>
        </label>
        <button
          type="button" className="text-sm text-indigo-600 hover:underline disabled:opacity-40" disabled={undo.length === 0}
          onClick={() => { const prev = undo[undo.length - 1]; if (prev) { setShapes(prev); setUndo(undo.slice(0, -1)); } }}
        >
          Undo
        </button>
        <button
          type="button" className="text-sm text-red-600 hover:underline disabled:opacity-40" disabled={shapes.length === 0}
          onClick={() => { if (window.confirm('Remove everything drawn so far?')) change([]); }}
        >
          Clear
        </button>
        {(bg.x !== 0 || bg.y !== 0) && (
          <button type="button" className="text-sm text-indigo-600 hover:underline" onClick={() => setBg({ x: 0, y: 0 })}>Reset answer position</button>
        )}
        <label className="flex items-center gap-1.5 text-sm text-slate-600">
          <input type="checkbox" checked={showPicture} onChange={(e) => setShowPicture(e.target.checked)} /> Show the answer
        </label>
        <ZoomControls zoom={zoomState.zoom} onZoomIn={zoomState.zoomIn} onZoomOut={zoomState.zoomOut} onFit={zoomState.fit} label="Overlay zoom" />
        <div className="ml-auto flex items-center gap-2">
          <span className="text-xs text-slate-500">{shapes.length} shape{shapes.length === 1 ? '' : 's'}</span>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" disabled={shapes.length === 0 || save.isPending} onClick={() => save.mutate()}>{save.isPending ? 'Saving…' : 'Save overlay'}</Button>
        </div>
      </div>
      {save.error && <p role="alert" className="border-b border-red-200 bg-red-50 px-4 py-2 text-sm text-red-700">{(save.error as Error).message}</p>}
      <p className="border-b border-slate-100 bg-slate-50 px-4 py-1.5 text-xs text-slate-500">
        Draw the correct graph or picture over the answer you chose: it is saved as an overlay you can lay over every script for this question and turn, move and resize to fit.
        {' '}Pen: hold and drag. Line and Circle: drag. Text: click, type, Enter. Erase: click a shape.
        {' '}Move drawing slides everything you have drawn; Move answer slides the candidate&apos;s answer underneath it (to line the two up; the arrow keys nudge too, Shift for bigger steps).
      </p>

      <div ref={paneRef} className="relative min-h-0 flex-1 overflow-auto bg-slate-100 p-3">
        <div className="relative inline-block">
          <Stage
            width={imgW * scale} height={imgH * scale} scaleX={scale} scaleY={scale}
            onMouseDown={down} onMouseMove={move} onMouseUp={up} onTouchStart={down} onTouchMove={move} onTouchEnd={up}
            style={{ cursor: tool === 'erase' ? 'not-allowed' : MOVE_TOOLS.includes(tool) ? 'move' : 'crosshair', background: '#fff', border: '1px solid #cbd5e1' }}
          >
            <Layer>
              {image && showPicture && <KonvaImage image={image} x={bg.x + (tool === 'moveAnswer' ? drag.dx : 0)} y={bg.y + (tool === 'moveAnswer' ? drag.dy : 0)} width={imgW} height={imgH} opacity={0.5} listening={false} />}
              <Group x={tool === 'moveDrawing' ? drag.dx : 0} y={tool === 'moveDrawing' ? drag.dy : 0}>
                {shapes.map((sh, i) => (
                  <Group key={i} {...eraseProps(i)}>
                    <OverlayShapeView shape={sh} color={DRAW_COLOR} />
                  </Group>
                ))}
              </Group>
              {draft && draft.type === 'pen' && <Line points={draft.points} stroke={DRAW_COLOR} strokeWidth={draft.w} tension={0.35} lineCap="round" lineJoin="round" opacity={0.8} />}
              {draft && draft.type === 'line' && <Line points={draft.points} stroke={DRAW_COLOR} strokeWidth={draft.w} lineCap="round" opacity={0.8} />}
              {draft && draft.type === 'circle' && <Circle x={draft.x} y={draft.y} radius={draft.r} stroke={DRAW_COLOR} strokeWidth={draft.w} opacity={0.8} />}
            </Layer>
          </Stage>
          {text && (
            <input
              autoFocus
              value={text.value}
              placeholder="Type, then Enter"
              onChange={(e) => setText({ ...text, value: e.target.value })}
              onKeyDown={(e) => { if (e.key === 'Enter') addText(); if (e.key === 'Escape') setText(null); }}
              onBlur={addText}
              className="absolute z-10 rounded border border-indigo-400 bg-white px-1 py-0.5 text-sm shadow focus:outline-none"
              style={{ left: text.x * scale, top: text.y * scale }}
            />
          )}
        </div>
      </div>
    </div>
  );
}
