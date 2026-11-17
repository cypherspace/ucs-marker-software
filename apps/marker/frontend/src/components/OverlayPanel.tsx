import { useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { api } from '../api';
import { questionLabel } from '../lib/questionLabel';
import {
  OVERLAY_COLORS, MAX_SCALE, MIN_SCALE, clampOpacity, clampScale, isMoved, normaliseRotation, nudge, resetPosition, rotateBy, scaleBy, type OverlayView,
} from '../lib/overlay';

// The tracing-paper controls, shown in a dockable panel beside the script (like the mark scheme). The overlay can be
// dragged, turned, resized, flipped and recoloured at any time; "Lock" stops it being dragged by accident.
export function OverlayControls({ examId, questionId, hasOverlay, view, onChange, canDrag, onNudged, onEdit, onChanged }: {
  examId: string;
  questionId: string;
  hasOverlay: boolean;
  view: OverlayView;
  onChange: (change: Partial<OverlayView> | ((v: OverlayView) => OverlayView)) => void;
  // Whether the selected marking tool lets a drag move the overlay (not the circle, underline, ruler or text tools)
  canDrag: boolean;
  // Called when the arrow buttons move it, so the arrow keys can carry on from there
  onNudged: () => void;
  onEdit: () => void;
  onChanged: () => void;
}) {
  const others = useQuery({
    queryKey: ['overlays', examId],
    queryFn: () => api.listOverlays(examId),
    enabled: !hasOverlay,
  });
  const [source, setSource] = useState('');
  const copy = useMutation({
    mutationFn: async (fromId: string) => {
      const r = await api.getOverlay(examId, fromId);
      if (!r.data) throw new Error('That question no longer has an overlay.');
      return api.saveOverlay(examId, questionId, r.data);
    },
    onSuccess: () => { setSource(''); onChanged(); },
  });
  const remove = useMutation({
    mutationFn: () => api.deleteOverlay(examId, questionId),
    onSuccess: () => onChanged(),
  });

  const sources = (others.data?.data ?? []).filter((o) => o.question_id !== questionId);
  const btn = 'rounded bg-white px-2 py-1 text-xs font-medium text-slate-700 ring-1 ring-slate-300 hover:bg-slate-100';
  const label = 'block text-xs font-medium text-slate-600';
  const step = (dx: number, dy: number, big: boolean) => { onChange((v) => nudge(v, dx * (big ? 10 : 1), dy * (big ? 10 : 1))); onNudged(); };

  if (!hasOverlay) {
    return (
      <div className="h-full space-y-3 overflow-y-auto p-3 text-sm">
        <p className="text-slate-600">No overlay for this question yet. Draw the correct graph or picture over a candidate&apos;s answer, then lay it over any script.</p>
        <button type="button" onClick={onEdit} className="w-full rounded bg-indigo-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-indigo-700">
          Draw an overlay…
        </button>
        {sources.length > 0 && (
          <div className="space-y-1 border-t border-rose-200 pt-2">
            <label className={label} htmlFor="overlay-source">…or copy one from another question</label>
            <div className="flex gap-2">
              <select id="overlay-source" value={source} onChange={(e) => setSource(e.target.value)} className="min-w-0 flex-1 rounded border border-slate-300 bg-white px-2 py-1 text-sm">
                <option value="">Choose a question</option>
                {sources.map((o) => <option key={o.question_id} value={o.question_id}>Q{questionLabel(o.question_number)} ({o.shapes} shapes)</option>)}
              </select>
              <button type="button" disabled={!source || copy.isPending} onClick={() => copy.mutate(source)} className="rounded bg-indigo-600 px-3 py-1 text-xs font-medium text-white disabled:opacity-50">
                {copy.isPending ? 'Copying…' : 'Copy'}
              </button>
            </div>
          </div>
        )}
        {copy.error && <p role="alert" className="text-xs text-red-600">{(copy.error as Error).message}</p>}
      </div>
    );
  }

  return (
    <div className="h-full space-y-3 overflow-y-auto p-3 text-sm">
      <p className="text-xs text-slate-600">
        {view.locked
          ? 'Locked in place. Unlock it to drag it again.'
          : canDrag
            ? 'Drag the overlay on the script to move it. Double-click still places ticks and crosses through it.'
            : 'The selected tool draws on the script, so the overlay cannot be dragged now. Pick a tick tool to drag it, or use the arrows below.'}
        {' '}Its place is remembered for this question, so it stays put from script to script.
      </p>

      <label className="flex items-center gap-1.5 font-medium text-slate-700">
        <input type="checkbox" checked={view.locked} onChange={(e) => onChange({ locked: e.target.checked })} /> Lock in place
      </label>

      <div>
        <span className={label}>Move (Shift: bigger steps)</span>
        <div className="mt-1 grid w-28 grid-cols-3 gap-1" role="group" aria-label="Move the overlay">
          <span />
          <button type="button" className={btn} aria-label="Move up" onClick={(e) => step(0, -1, e.shiftKey)}>↑</button>
          <span />
          <button type="button" className={btn} aria-label="Move left" onClick={(e) => step(-1, 0, e.shiftKey)}>←</button>
          <button type="button" className={btn} aria-label="Move down" onClick={(e) => step(0, 1, e.shiftKey)}>↓</button>
          <button type="button" className={btn} aria-label="Move right" onClick={(e) => step(1, 0, e.shiftKey)}>→</button>
        </div>
      </div>

      <div>
        <label className={label} htmlFor="overlay-rot">Rotate (or drag the round handle on the overlay)</label>
        <input id="overlay-rot" type="range" min={-180} max={180} step={0.2} value={view.rotation} onChange={(e) => onChange({ rotation: normaliseRotation(Number(e.target.value)) })} className="w-full" />
        <div className="flex items-center gap-1">
          <button type="button" className={btn} onClick={() => onChange((v) => rotateBy(v, -1))} aria-label="Rotate 1 degree left">−1°</button>
          <button type="button" className={btn} onClick={() => onChange((v) => rotateBy(v, -0.2))} aria-label="Rotate 0.2 degrees left">−0.2°</button>
          <input
            type="number" step={0.1} min={-180} max={180} aria-label="Rotation in degrees"
            value={Math.round(view.rotation * 100) / 100}
            onChange={(e) => { const n = Number(e.target.value); if (Number.isFinite(n)) onChange({ rotation: normaliseRotation(n) }); }}
            className="min-w-0 flex-1 rounded border border-slate-300 bg-white px-1 py-1 text-center text-xs"
          />
          <button type="button" className={btn} onClick={() => onChange((v) => rotateBy(v, 0.2))} aria-label="Rotate 0.2 degrees right">+0.2°</button>
          <button type="button" className={btn} onClick={() => onChange((v) => rotateBy(v, 1))} aria-label="Rotate 1 degree right">+1°</button>
        </div>
      </div>

      <div>
        <label className={label} htmlFor="overlay-scale">Size: {Math.round(view.scale * 100)}%</label>
        <div className="flex items-center gap-1">
          <button type="button" className={btn} onClick={() => onChange((v) => scaleBy(v, 1 / 1.02))} aria-label="Smaller">−</button>
          <input id="overlay-scale" type="range" min={MIN_SCALE} max={MAX_SCALE} step={0.01} value={view.scale} onChange={(e) => onChange({ scale: clampScale(Number(e.target.value)) })} className="min-w-0 flex-1" />
          <button type="button" className={btn} onClick={() => onChange((v) => scaleBy(v, 1.02))} aria-label="Bigger">+</button>
        </div>
      </div>

      <div>
        <label className={label} htmlFor="overlay-opacity">Opacity: {Math.round(view.opacity * 100)}%</label>
        <input id="overlay-opacity" type="range" min={0.05} max={1} step={0.05} value={view.opacity} onChange={(e) => onChange({ opacity: clampOpacity(Number(e.target.value)) })} className="w-full" />
      </div>

      <div className="flex items-center gap-1.5" role="group" aria-label="Overlay colour">
        <span className={label}>Colour</span>
        {OVERLAY_COLORS.map((c) => (
          <button
            key={c} type="button" onClick={() => onChange({ color: c })} aria-label={`Colour ${c}`} aria-pressed={view.color === c}
            className={`h-5 w-5 rounded-full border-2 ${view.color === c ? 'border-slate-800' : 'border-white ring-1 ring-slate-300'}`} style={{ background: c }}
          />
        ))}
      </div>

      <div className="flex flex-wrap gap-1.5">
        <button type="button" className={btn} aria-pressed={view.flip} onClick={() => onChange({ flip: !view.flip })}>Flip ↔</button>
        <button type="button" className={btn} disabled={!isMoved(view)} onClick={() => onChange((v) => resetPosition(v))}>Reset position</button>
      </div>

      <div className="flex items-center justify-between border-t border-rose-200 pt-2">
        <button type="button" className="text-xs text-indigo-600 hover:underline" onClick={onEdit}>Edit the drawing…</button>
        <button
          type="button" disabled={remove.isPending} className="text-xs text-red-600 hover:underline disabled:opacity-50"
          onClick={() => { if (window.confirm('Remove the overlay for this question for everyone?')) remove.mutate(); }}
        >
          Remove overlay
        </button>
      </div>
      {remove.error && <p role="alert" className="text-xs text-red-600">{(remove.error as Error).message}</p>}
    </div>
  );
}
