import { useEffect, useState, useCallback } from 'react';
import { useParams, useNavigate, useLocation } from 'react-router-dom';
import { useBackTarget } from '../lib/nav';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api, HttpError } from '../api';
import { AnnotationCanvas, markTickTotal } from '../components/AnnotationCanvas';
import { ScriptClipEditor } from '../components/ScriptClipEditor';
import { Button } from '../components/ui';
import type { AnnotationData, QueueClip } from '@marker/shared-types';

// Loads one clip (the one in the URL, else the first this teacher hasn't finished).
// The panel below is keyed by clip id, so ticks and typed marks can never carry over to another script.
export function MarkingInterface() {
  const { examId, questionId, clipId } = useParams<{ examId: string; questionId: string; clipId?: string }>();
  const navigate = useNavigate();
  const loc = useLocation();
  const backTarget = useBackTarget({ to: '/my-exams', label: 'Marking' });
  // Moving between scripts keeps the remembered "came from" page, so Back still returns to it.
  const keep = { state: loc.state };

  const clipQ = useQuery({
    queryKey: ['clip-queue', examId, questionId, clipId ?? 'next'],
    queryFn: () => api.getNextClip(examId!, questionId!, clipId),
    refetchOnWindowFocus: false,
    gcTime: 0,
  });

  if (clipQ.isLoading) return <div className="p-6 text-slate-500">Loading…</div>;

  if (clipQ.error) {
    return (
      <div className="p-6 text-center">
        <p role="alert" className="mb-4 text-red-700">{(clipQ.error as Error).message}</p>
        <Button onClick={() => navigate(`/mark/${examId}/${questionId}`, keep)}>Back to the first unmarked clip</Button>
      </div>
    );
  }

  const clip = clipQ.data?.data;
  if (!clip) {
    const firstId = clipQ.data?.meta?.first_id;
    return (
      <div className="p-6 text-center">
        <div className="text-2xl mb-2">All done!</div>
        <p className="text-slate-500 mb-4">You've marked all clips for this question.</p>
        <div className="flex justify-center gap-2">
          {firstId && <Button onClick={() => navigate(`/mark/${examId}/${questionId}/${firstId}`, keep)}>Review your marking</Button>}
          <Button variant="primary" onClick={() => navigate(backTarget.to, { state: backTarget.state })}>Back to {backTarget.label}</Button>
        </div>
      </div>
    );
  }

  return (
    <MarkingPanel
      key={clip.id}
      clip={clip}
      examId={examId!}
      questionId={questionId!}
      refetch={() => { void clipQ.refetch(); }}
    />
  );
}

const snapshot = (a: AnnotationData, typed: string | null) => JSON.stringify([a.annotations, typed]);

function MarkingPanel({ clip, examId, questionId, refetch }: {
  clip: QueueClip; examId: string; questionId: string; refetch: () => void;
}) {
  const navigate = useNavigate();
  const loc = useLocation();
  const backTarget = useBackTarget({ to: '/my-exams', label: 'Marking' });
  const qc = useQueryClient();
  const question = clip.question;
  const maxMarks = question.max_marks;

  const initialAnnotations: AnnotationData = clip.my_mark?.annotation_data ?? { annotations: [] };
  const initialTicks = markTickTotal(initialAnnotations);
  // `typed` is null while the Marks box simply follows the Mark ticks; typing a different number overrides them.
  const initialTyped = clip.my_mark?.marks_awarded == null
    ? null
    : (initialTicks > 0 && clip.my_mark.marks_awarded === initialTicks ? null : String(clip.my_mark.marks_awarded));

  const [annotations, setAnnotations] = useState<AnnotationData>(initialAnnotations);
  const [typed, setTyped] = useState<string | null>(initialTyped);
  const [saved, setSaved] = useState(() => snapshot(initialAnnotations, initialTyped));
  const [showMs, setShowMs] = useState(false);
  const [showPages, setShowPages] = useState(false);
  const [showAi, setShowAi] = useState(false);
  const [showOcr, setShowOcr] = useState(false);
  const [ocrText, setOcrText] = useState<string | null>(null);

  const ticks = markTickTotal(annotations);
  const marks = typed ?? (ticks > 0 ? String(ticks) : '');
  const marksNum = Number(marks);
  const marksValid = marks !== '' && Number.isInteger(marksNum) && marksNum >= 0 && marksNum <= maxMarks;
  const overriding = typed !== null && ticks > 0 && typed !== String(ticks);
  const dirty = snapshot(annotations, typed) !== saved;

  const listQ = useQuery({
    queryKey: ['clip-list', examId, questionId],
    queryFn: () => api.listClips(examId, questionId),
    refetchOnWindowFocus: false,
    gcTime: 0,
  });

  const saveMutation = useMutation({
    mutationFn: (draft: boolean) => api.saveMark({
      clip_id: clip.id,
      marks_awarded: marksValid ? marksNum : null,
      annotation_data: annotations,
      draft,
    }),
    onSuccess: () => {
      setSaved(snapshot(annotations, typed));
      void qc.invalidateQueries({ queryKey: ['clip-list', examId, questionId] });
    },
  });

  const ocrMutation = useMutation({
    mutationFn: (refresh: boolean) => api.runOcr(clip.id, refresh),
    onSuccess: (r) => setOcrText(r.data.ocr_text),
  });

  const handleAnnotationChange = useCallback((data: AnnotationData) => setAnnotations(data), []);

  // Warn before closing the tab with unsaved ticks
  useEffect(() => {
    if (!dirty) return;
    const handler = (e: BeforeUnloadEvent) => { e.preventDefault(); };
    window.addEventListener('beforeunload', handler);
    return () => window.removeEventListener('beforeunload', handler);
  }, [dirty]);

  const go = (id: string | null) =>
    navigate(id ? `/mark/${examId}/${questionId}/${id}` : `/mark/${examId}/${questionId}`, { state: loc.state });

  // Leave this clip, keeping any ticks and typed mark as a draft (a draft never counts as marked)
  async function leaveTo(id: string | null) {
    if (dirty) {
      try { await saveMutation.mutateAsync(true); } catch { return; }
    }
    go(id);
  }

  async function saveAndNext() {
    try { await saveMutation.mutateAsync(false); } catch { return; }
    go(clip.next_unmarked_id);
  }

  const list = listQ.data?.data ?? [];
  const statusText = saveMutation.isPending ? 'Saving…'
    : dirty ? 'Unsaved changes'
    : saveMutation.isSuccess ? (saveMutation.variables ? 'Draft saved' : 'Saved')
    : clip.state === 'marked' ? 'Saved'
    : clip.state === 'draft' ? 'Draft saved'
    : '';

  return (
    <div className="flex h-full flex-col">
      {/* Header bar */}
      <div className="flex flex-wrap items-center gap-3 border-b border-slate-200 bg-white px-4 py-2">
        <button onClick={async () => { if (dirty) { try { await saveMutation.mutateAsync(true); } catch { return; } } navigate(backTarget.to, { state: backTarget.state }); }}
          className="text-sm font-medium text-indigo-600 hover:underline">← Back to {backTarget.label}</button>
        <div className="font-medium text-slate-700">
          Question {question.question_number} — max {maxMarks} marks
        </div>

        <div className="flex items-center gap-1 text-sm">
          <Button className="!px-2.5" disabled={!clip.prev_id || saveMutation.isPending} onClick={() => void leaveTo(clip.prev_id)} aria-label="Previous script">‹ Prev</Button>
          <select
            aria-label="Jump to a script"
            value={clip.id}
            onChange={(e) => void leaveTo(e.target.value)}
            className="rounded border border-slate-300 bg-white px-2 py-1.5 text-sm"
          >
            {(list.length ? list : [{ id: clip.id, state: clip.state }]).map((c, i) => (
              <option key={c.id} value={c.id}>
                Script {i + 1} of {clip.total}{c.state === 'marked' ? ' ✓' : c.state === 'draft' ? ' …' : ''}
              </option>
            ))}
          </select>
          <Button className="!px-2.5" disabled={!clip.next_id || saveMutation.isPending} onClick={() => void leaveTo(clip.next_id)} aria-label="Next script">Next ›</Button>
          {clip.next_unmarked_id && (
            <Button className="!px-2.5" disabled={saveMutation.isPending} onClick={() => void leaveTo(clip.next_unmarked_id)}>Next unmarked</Button>
          )}
        </div>

        <div className="ml-auto flex items-center gap-3">
          <span className="text-xs text-slate-500" aria-live="polite">{statusText}</span>
          <span className="text-sm text-slate-500">{clip.remaining} to mark</span>
          <button
            onClick={() => {
              const next = !showOcr;
              setShowOcr(next);
              if (next && ocrText === null && clip.ocr_text === null && !ocrMutation.isPending) ocrMutation.mutate(false);
            }}
            aria-pressed={showOcr}
            className={`rounded px-3 py-1 text-xs font-medium transition-colors ${showOcr ? 'bg-sky-100 text-sky-700' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'}`}
          >
            {showOcr ? 'Hide typed text' : 'Typed text'}
          </button>
          {clip.ai_mark && (
            <button
              onClick={() => setShowAi((v) => !v)}
              aria-pressed={showAi}
              className={`rounded px-3 py-1 text-xs font-medium transition-colors ${showAi ? 'bg-violet-100 text-violet-700' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'}`}
            >
              {showAi ? 'Hide AI suggestion' : 'AI suggestion'}
            </button>
          )}
          <button
            onClick={() => setShowMs((v) => !v)}
            className={`rounded px-3 py-1 text-xs font-medium transition-colors ${showMs ? 'bg-amber-100 text-amber-700' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'}`}
          >
            {showMs ? 'Hide MS' : 'Show MS'}
          </button>
          <button
            onClick={() => setShowPages(true)}
            title="See the other pages of this script and choose where the answer is"
            className={`rounded px-3 py-1 text-xs font-medium transition-colors ${clip.clip_source === 'manual' ? 'bg-indigo-100 text-indigo-700' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'}`}
          >
            {clip.clip_source === 'manual' ? 'Script pages (custom)' : 'Script pages'}
          </button>
        </div>
      </div>

      {clip.changed_after_marking && (
        <div role="status" className="border-b border-amber-200 bg-amber-50 px-4 py-2 text-sm text-amber-800">
          The pages for this answer were changed after it was first marked, so earlier marks may refer to the old selection.
        </div>
      )}

      {/* Main content */}
      <div className="flex min-h-0 flex-1 gap-4 p-4">
        {/* Annotation area: the tools stay in view, the script scrolls inside its own pane */}
        <div className="min-h-0 min-w-0 flex-1">
          <AnnotationCanvas
            key={`${clip.id}-${clip.reclipped_at ?? ''}`}
            clipUrl={clip.clip_url}
            initialData={annotations}
            onChange={handleAnnotationChange}
            maxMarkTicks={maxMarks}
          />
        </div>

        {/* Side panels */}
        {((showMs && clip.ms_url) || showAi || showOcr) && (
          <div className="min-h-0 w-80 flex-shrink-0 space-y-3 overflow-y-auto">
            {showMs && clip.ms_url && (
              <div className="rounded-lg border border-amber-200 bg-amber-50 p-2">
                <div className="mb-1 text-xs font-medium text-amber-700 uppercase tracking-wide">Mark Scheme</div>
                <img src={clip.ms_url} alt="Mark scheme" className="w-full rounded" />
              </div>
            )}
            {showAi && clip.ai_mark && (
              <div className="rounded-lg border border-violet-200 bg-violet-50 p-3 text-sm text-violet-950">
                <div className="mb-1 text-xs font-medium text-violet-700 uppercase tracking-wide">AI suggestion</div>
                {clip.ai_mark.marks_awarded !== null ? (
                  <p className="text-lg font-semibold">{clip.ai_mark.marks_awarded} <span className="text-sm font-normal text-violet-700">/ {maxMarks}</span></p>
                ) : (
                  <p className="text-violet-700">No mark suggested (feedback only).</p>
                )}
                {clip.ai_mark.reasoning && <p className="mt-2"><span className="font-medium">Reasoning:</span> {clip.ai_mark.reasoning}</p>}
                {clip.ai_mark.feedback && <p className="mt-2"><span className="font-medium">Feedback:</span> {clip.ai_mark.feedback}</p>}
                {clip.ai_mark.marks_awarded !== null && (
                  <button
                    onClick={() => setTyped(String(clip.ai_mark!.marks_awarded))}
                    className="mt-3 rounded bg-violet-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-violet-700"
                  >
                    Use this mark
                  </button>
                )}
                <p className="mt-2 text-xs text-violet-700">Only the mark you save counts.</p>
              </div>
            )}
            {showOcr && (
              <div className="rounded-lg border border-sky-200 bg-sky-50 p-3 text-sm text-sky-950">
                <div className="mb-1 text-xs font-medium text-sky-700 uppercase tracking-wide">Typed text (automatic, may contain mistakes)</div>
                {ocrMutation.isPending ? (
                  <p className="text-sky-700">Reading the handwriting…</p>
                ) : ocrMutation.error ? (
                  <div role="alert" className="text-red-700">
                    {ocrMutation.error instanceof HttpError && ocrMutation.error.code === 'AI_NOT_CONFIGURED'
                      ? 'Text recognition isn\'t set up on this server.'
                      : (ocrMutation.error as Error).message}
                    <button onClick={() => ocrMutation.mutate(false)} className="ml-2 underline">Try again</button>
                  </div>
                ) : (ocrText ?? clip.ocr_text) !== null ? (
                  <>
                    <pre className="whitespace-pre-wrap font-sans">{(ocrText ?? clip.ocr_text) || '(nothing readable)'}</pre>
                    <button onClick={() => ocrMutation.mutate(true)} className="mt-2 text-xs text-sky-700 underline">Read again</button>
                  </>
                ) : null}
              </div>
            )}
          </div>
        )}
      </div>

      {/* Mark entry footer */}
      <div className="flex flex-wrap items-center gap-4 border-t border-slate-200 bg-white px-4 py-3">
        <div className="flex items-center gap-2">
          <label htmlFor="marks" className="text-sm font-medium text-slate-700">Marks:</label>
          <input
            id="marks"
            type="number"
            min={0}
            max={maxMarks}
            step={1}
            value={marks}
            onChange={(e) => setTyped(e.target.value === String(ticks) && ticks > 0 ? null : e.target.value)}
            className="w-20 rounded border border-slate-300 px-2 py-1.5 text-center text-sm font-medium focus:border-indigo-500 focus:outline-none"
            placeholder={`0–${maxMarks}`}
          />
          <span className="text-sm text-slate-400">/ {maxMarks}</span>
        </div>

        <span className="text-xs text-slate-500">
          {ticks > 0
            ? `${ticks} mark tick${ticks === 1 ? '' : 's'}`
            : 'Place mark ticks on the answer, or type a mark'}
          {overriding && (
            <>
              {' · '}typed mark in use{' '}
              <button onClick={() => setTyped(null)} className="font-medium text-indigo-600 underline">use tick total ({ticks})</button>
            </>
          )}
        </span>

        {marks !== '' && !marksValid && (
          <span role="alert" className="text-sm text-red-600">Enter a whole number from 0 to {maxMarks}.</span>
        )}
        {saveMutation.error && (
          <span role="alert" className="text-sm text-red-600">{(saveMutation.error as Error).message}</span>
        )}

        <div className="ml-auto flex gap-2">
          <Button
            disabled={!marksValid || saveMutation.isPending || (!dirty && clip.state === 'marked')}
            onClick={() => saveMutation.mutate(false, { onSuccess: refetch })}
          >
            Save
          </Button>
          <Button variant="primary" disabled={!marksValid || saveMutation.isPending} onClick={() => void saveAndNext()}>
            {saveMutation.isPending ? 'Saving…' : 'Save & Next →'}
          </Button>
        </div>
      </div>

      {showPages && (
        <ScriptClipEditor
          scriptId={clip.script_id}
          questionId={question.id}
          questionNumber={question.question_number}
          defaultRegions={question.clip_coordinates}
          defaultNameZones={question.name_zones}
          onClose={() => setShowPages(false)}
          onSaved={() => {
            // Ticks were placed on the old crop, so they no longer line up
            setShowPages(false);
            setAnnotations({ annotations: [] });
            setOcrText(null);
            ocrMutation.reset();
            refetch();
          }}
        />
      )}
    </div>
  );
}
