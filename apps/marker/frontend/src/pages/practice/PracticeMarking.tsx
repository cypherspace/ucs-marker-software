import { useEffect, useRef, useState, useCallback } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, Navigate, useNavigate, useParams } from 'react-router-dom';
import { api } from '../../api';
import { AnnotationCanvas } from '../../components/AnnotationCanvas';
import { AnnotationToolbar, COLORS, TOOLS, type Tool } from '../../components/AnnotationToolbar';
import { DockablePanel } from '../../components/DockablePanel';
import { Button } from '../../components/ui';
import { ZoomableImage } from '../../components/ZoomableImage';
import { ZoomControls } from '../../components/ZoomControls';
import { useZoom } from '../../hooks/useZoom';
import { usePersistedState } from '../../hooks/usePersistedState';
import { annotationMark, markTickTotal, nextNumber } from '../../lib/annotations';
import { applyDigit, isMarkDigitKey, isSaveEnterKey, type DigitBuffer } from '../../lib/markKeys';
import type { Annotation, StudentItemView } from '@marker/shared-types';

// /practice/:setId goes to the first clip not yet marked; /practice/:setId/:itemId is one clip.
export function PracticeMarking() {
  const { setId, itemId } = useParams<{ setId: string; itemId?: string }>();
  const setQ = useQuery({ queryKey: ['practice', 'set', setId], queryFn: () => api.studentSet(setId!), enabled: !itemId, gcTime: 0 });
  if (!itemId) {
    if (setQ.isLoading) return <div className="p-6 text-slate-500">Loading…</div>;
    if (setQ.error) return <div role="alert" className="p-6 text-red-700">{(setQ.error as Error).message}</div>;
    const items = setQ.data?.data.items ?? [];
    const next = items.find((i) => !i.done) ?? items[0];
    if (!next) return <div className="p-6 text-slate-500">This set has no clips.</div>;
    return <Navigate to={items.every((i) => i.done) ? `/practice/${setId}/summary` : `/practice/${setId}/${next.item_id}`} replace />;
  }
  return <ItemLoader setId={setId!} itemId={itemId} />;
}

function ItemLoader({ setId, itemId }: { setId: string; itemId: string }) {
  const q = useQuery({ queryKey: ['practice', 'item', itemId], queryFn: () => api.studentItem(itemId), refetchOnWindowFocus: false, gcTime: 0 });
  if (q.isLoading) return <div className="p-6 text-slate-500">Loading…</div>;
  if (q.error || !q.data) {
    return (
      <div className="p-6 text-center">
        <p role="alert" className="mb-4 text-red-700">{(q.error as Error | null)?.message ?? 'Could not load this one.'}</p>
        <a href="/practice" className="text-indigo-600 underline">Back to your sets</a>
      </div>
    );
  }
  return <PracticePanel key={itemId} setId={setId} item={q.data.data} />;
}

function PracticePanel({ setId, item }: { setId: string; item: StudentItemView }) {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const maxMarks = item.max_marks;
  const [annotations, setAnnotations] = useState<Annotation[]>(
    item.result && Array.isArray(item.result.annotation_data) ? (item.result.annotation_data as Annotation[]) : []);
  const [typed, setTyped] = useState<string | null>(null);
  const [result, setResult] = useState(item.result);
  const submitted = Boolean(result);
  const [showMs, setShowMs] = usePersistedState<boolean>('practice.ms.open', true, (v): v is boolean => typeof v === 'boolean');
  const [tool, setTool] = usePersistedState<Tool>('marker.tool', 'mark_tick', (v): v is Tool => TOOLS.includes(v as Tool));
  const [color, setColor] = usePersistedState<string>('marker.color', COLORS[0], (v): v is string => COLORS.includes(v as string));
  const zoom = useZoom('marker.zoom.script');

  const data = { annotations };
  const ticks = markTickTotal(data);
  const auto = annotationMark(data);
  const marks = submitted ? String(result!.your_mark) : (typed ?? (auto !== null ? String(auto) : ''));
  const marksNum = Number(marks);
  // Unlike a teacher, a student must give a mark (a cross counts as 0): an accidental Enter must not lock in a blank
  const canSubmit = !submitted && marks !== '' && Number.isInteger(marksNum) && marksNum >= 0 && marksNum <= maxMarks;

  const submit = useMutation({
    mutationFn: () => api.submitPractice(item.item_id, marksNum, annotations),
    onSuccess: (r) => {
      setResult(r.data);
      void qc.invalidateQueries({ queryKey: ['practice', 'sets'] });
    },
  });

  const addAnnotation = useCallback((a: Annotation) => setAnnotations((l) => [...l, a]), []);
  const removeAnnotation = useCallback((id: string) => setAnnotations((l) => l.filter((a) => a.id !== id)), []);

  const goNext = () => {
    if (item.next_undone_id) navigate(`/practice/${setId}/${item.next_undone_id}`);
    else navigate(`/practice/${setId}/summary`);
  };

  // Typing a digit sets the mark; Enter submits it (and, once submitted, moves on)
  const digits = useRef<DigitBuffer>({ text: '', at: 0 });
  const act = useRef({ submit: () => {}, next: () => {} });
  act.current = { submit: () => { if (canSubmit && !submit.isPending) submit.mutate(); }, next: goNext };
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (isSaveEnterKey(e, tool)) {
        e.preventDefault();
        if (submitted) act.current.next(); else act.current.submit();
        return;
      }
      if (submitted) return;
      const t = e.target as HTMLElement | null;
      const inField = t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable);
      if ((e.key === 'Backspace' || e.key === 'Delete') && !inField && tool !== 'text' && typed !== null) {
        e.preventDefault(); digits.current = { text: '', at: 0 }; setTyped(null); return;
      }
      if (!isMarkDigitKey(e, tool)) return;
      e.preventDefault();
      const now = Date.now();
      const next = applyDigit(digits.current, e.key, now, maxMarks);
      digits.current = { text: next, at: now };
      setTyped(auto !== null && next === String(auto) ? null : next);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [tool, maxMarks, auto, typed, submitted]);

  return (
    <div className="flex h-full flex-col">
      <div className="flex flex-wrap items-center gap-3 border-b border-slate-200 bg-white px-4 py-2">
        <Link to="/practice" className="text-sm font-medium text-indigo-600 hover:underline">← Your sets</Link>
        <span className="text-sm font-medium text-slate-700">{item.set_name}</span>
        <span className="rounded bg-slate-200 px-2 py-0.5 text-xs font-semibold text-slate-700">Question {item.question_label}</span>
        <span className="text-sm text-slate-500">Clip {item.position} of {item.total}</span>
        <div className="ml-auto flex items-center gap-3">
          <ZoomControls zoom={zoom.zoom} onZoomIn={zoom.zoomIn} onZoomOut={zoom.zoomOut} onFit={zoom.fit} label="Script zoom" />
          <button
            onClick={() => setShowMs(!showMs)}
            disabled={!item.ms_url}
            aria-pressed={showMs}
            title={item.ms_url ? 'Show or hide the mark scheme' : 'No mark scheme for this one'}
            className={`rounded px-3 py-1 text-xs font-medium disabled:cursor-not-allowed disabled:opacity-50 ${showMs ? 'bg-amber-100 text-amber-700' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'}`}
          >
            {showMs ? 'Hide MS' : 'Show MS'}
          </button>
        </div>
      </div>

      {item.closed && !submitted && (
        <div role="status" className="border-b border-amber-200 bg-amber-50 px-4 py-2 text-sm text-amber-800">
          Your teacher has closed this set, so marks can no longer be submitted.
        </div>
      )}

      {result && (
        <div role="status" className="border-b border-indigo-200 bg-indigo-50 px-4 py-3 text-sm text-indigo-900">
          <div className="flex flex-wrap items-center gap-x-6 gap-y-2">
            <span>Your mark: <strong className="text-lg">{result.your_mark}</strong> / {maxMarks}</span>
            <span>
              Teachers' mark: <strong className="text-lg">{result.teacher_mark ?? '—'}</strong>{result.teacher_mark != null && ` / ${maxMarks}`}
            </span>
            {result.difference != null && (
              <span className={result.difference === 0 ? 'font-medium text-green-700' : 'font-medium text-amber-800'}>
                {result.difference === 0 ? 'Exactly the same' : result.difference > 0
                  ? `You gave ${result.difference} more than the teachers`
                  : `You gave ${-result.difference} less than the teachers`}
              </span>
            )}
            <Button variant="primary" className="ml-auto" onClick={goNext}>
              {item.next_undone_id ? 'Next →' : 'See your results →'}
            </Button>
          </div>
        </div>
      )}

      <DockablePanel
        title="Mark scheme"
        storageKey="marker.panel.ms"
        open={showMs && Boolean(item.ms_url)}
        onClose={() => setShowMs(false)}
        panel={item.ms_url ? <ZoomableImage src={item.ms_url} alt="Mark scheme" storageKey="marker.zoom.ms" /> : null}
      >
        <div className="flex h-full min-h-0 gap-4 p-4">
          <AnnotationToolbar
            tool={tool}
            onTool={setTool}
            color={color}
            onColor={setColor}
            canUndo={!submitted && annotations.length > 0}
            onUndo={() => setAnnotations((l) => l.slice(0, -1))}
            top={
              <>
                <div>
                  <label htmlFor="marks" className="block text-xs font-medium uppercase tracking-wide text-slate-500">Your mark (out of {maxMarks})</label>
                  <input
                    id="marks"
                    type="number"
                    min={0}
                    max={maxMarks}
                    step={1}
                    value={marks}
                    disabled={submitted}
                    placeholder="–"
                    onChange={(e) => setTyped(auto !== null && e.target.value === String(auto) ? null : e.target.value)}
                    className="mt-1 w-full rounded border border-slate-300 px-2 py-1.5 text-center text-lg font-semibold focus:border-indigo-500 focus:outline-none disabled:bg-slate-100"
                  />
                  {marks !== '' && !submitted && !canSubmit && (
                    <p role="alert" className="mt-1 text-xs text-red-600">Enter a whole number from 0 to {maxMarks}.</p>
                  )}
                </div>
                {!submitted && (
                  <>
                    <Button variant="primary" className="w-full" disabled={!canSubmit || submit.isPending || item.closed} onClick={() => submit.mutate()}>
                      {submit.isPending ? 'Submitting…' : 'Submit my mark'}
                    </Button>
                    <p className="text-center text-[11px] leading-tight text-slate-500">
                      Then you'll see the teachers' mark. You can't change your mark afterwards.
                    </p>
                  </>
                )}
                {submit.error && <p role="alert" className="text-xs text-red-600">{(submit.error as Error).message}</p>}
              </>
            }
          />
          <AnnotationCanvas
            key={item.item_id}
            imageUrl={item.clip_url}
            annotations={annotations}
            tool={tool}
            color={color}
            zoom={zoom.zoom}
            onZoom={zoom.setZoom}
            onTool={setTool}
            onAdd={addAnnotation}
            onRemove={removeAnnotation}
            nextNumber={() => nextNumber(annotations)}
            readOnly={submitted}
            markTickCount={ticks}
            maxMarkTicks={maxMarks}
          />
        </div>
      </DockablePanel>
    </div>
  );
}
