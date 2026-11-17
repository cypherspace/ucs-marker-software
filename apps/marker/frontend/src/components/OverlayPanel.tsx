import { useEffect, useRef, useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { api } from '../api';
import { questionLabel } from '../lib/questionLabel';
import {
  OVERLAY_COLORS, MAX_SCALE, MIN_SCALE, clampOpacity, clampScale, isMoved, normaliseRotation, resetPosition, rotateBy, scaleBy, type OverlayView,
} from '../lib/overlay';

// Tracing paper controls for the marking page: show or hide the overlay, unlock it to move / turn / resize it into place,
// lock it so it stays put and marking works through it, and make, copy or remove the overlay for this question.
export function OverlayPanel({ examId, questionId, hasOverlay, view, onChange, adjusting, onAdjusting, onEdit, onChanged }: {
  examId: string;
  questionId: string;
  hasOverlay: boolean;
  view: OverlayView;
  onChange: (change: Partial<OverlayView> | ((v: OverlayView) => OverlayView)) => void;
  adjusting: boolean;
  onAdjusting: (on: boolean) => void;
  onEdit: () => void;
  onChanged: () => void;
}) {
  const [open, setOpen] = useState(false);
  const boxRef = useRef<HTMLDivElement>(null);

  // Click outside closes the popover (not while adjusting is in progress elsewhere: it only hides the controls)
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => { if (boxRef.current && !boxRef.current.contains(e.target as Node)) setOpen(false); };
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    window.addEventListener('mousedown', onDown);
    window.addEventListener('keydown', onKey);
    return () => { window.removeEventListener('mousedown', onDown); window.removeEventListener('keydown', onKey); };
  }, [open]);

  const others = useQuery({
    queryKey: ['overlays', examId],
    queryFn: () => api.listOverlays(examId),
    enabled: open && !hasOverlay,
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
    onSuccess: () => { onAdjusting(false); onChanged(); },
  });

  const sources = (others.data?.data ?? []).filter((o) => o.question_id !== questionId);
  const btn = 'rounded bg-slate-100 px-2 py-1 text-xs font-medium text-slate-700 hover:bg-slate-200';
  const label = 'block text-xs font-medium text-slate-500';
  const active = hasOverlay && view.show;

  return (
    <div ref={boxRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        title="Tracing-paper overlay: lay the correct graph or picture over the script"
        className={`rounded px-3 py-1 text-xs font-medium transition-colors ${active ? 'bg-rose-100 text-rose-700' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'}`}
      >
        Overlay{active ? ' on' : ''}
      </button>

      {open && (
        <div role="dialog" aria-label="Overlay controls" className="absolute right-0 z-30 mt-1 w-80 space-y-3 rounded-lg border border-slate-200 bg-white p-3 text-sm shadow-lg">
          {!hasOverlay ? (
            <>
              <p className="text-slate-600">No overlay for this question yet. Draw the correct graph or picture over a candidate&apos;s answer, then lay it over any script.</p>
              <button type="button" onClick={() => { setOpen(false); onEdit(); }} className="w-full rounded bg-indigo-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-indigo-700">
                Draw an overlay…
              </button>
              {sources.length > 0 && (
                <div className="space-y-1 border-t border-slate-100 pt-2">
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
            </>
          ) : (
            <>
              <div className="flex items-center justify-between gap-2">
                <label className="flex items-center gap-1.5 font-medium text-slate-700">
                  <input type="checkbox" checked={view.show} onChange={(e) => { onChange({ show: e.target.checked }); if (!e.target.checked) onAdjusting(false); }} /> Show overlay
                </label>
                <button
                  type="button"
                  disabled={!view.show}
                  aria-pressed={adjusting}
                  onClick={() => onAdjusting(!adjusting)}
                  className={`rounded px-3 py-1 text-xs font-medium disabled:opacity-40 ${adjusting ? 'bg-amber-500 text-white' : 'bg-slate-100 text-slate-700 hover:bg-slate-200'}`}
                  title={adjusting ? 'Lock the overlay in place so you can mark again' : 'Unlock to drag, turn and resize the overlay'}
                >
                  {adjusting ? '🔓 Unlocked: click to lock' : '🔒 Locked: click to adjust'}
                </button>
              </div>
              <p className="text-xs text-slate-500">
                Its place is remembered for this question, so it stays where you put it as you move from script to script.
              </p>

              <div>
                <label className={label} htmlFor="overlay-rot">Rotate: {Math.round(view.rotation * 10) / 10}°</label>
                <div className="flex items-center gap-1">
                  <button type="button" className={btn} onClick={() => onChange((v) => rotateBy(v, -1))} aria-label="Rotate 1 degree left">−1°</button>
                  <input id="overlay-rot" type="range" min={-180} max={180} step={0.5} value={view.rotation} onChange={(e) => onChange({ rotation: normaliseRotation(Number(e.target.value)) })} className="min-w-0 flex-1" />
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

              <div className="flex items-center justify-between border-t border-slate-100 pt-2">
                <button type="button" className="text-xs text-indigo-600 hover:underline" onClick={() => { setOpen(false); onEdit(); }}>Edit the drawing…</button>
                <button
                  type="button" disabled={remove.isPending} className="text-xs text-red-600 hover:underline disabled:opacity-50"
                  onClick={() => { if (window.confirm('Remove the overlay for this question for everyone?')) remove.mutate(); }}
                >
                  Remove overlay
                </button>
              </div>
              {remove.error && <p role="alert" className="text-xs text-red-600">{(remove.error as Error).message}</p>}
            </>
          )}
        </div>
      )}
    </div>
  );
}
