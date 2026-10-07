import { useState, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api, HttpError } from '../api';
import { AnnotationCanvas } from '../components/AnnotationCanvas';
import { ScriptClipEditor } from '../components/ScriptClipEditor';
import type { AnnotationData } from '@marker/shared-types';

export function MarkingInterface() {
  const { examId, questionId } = useParams<{ examId: string; questionId: string }>();
  const navigate = useNavigate();
  const qc = useQueryClient();

  const [marks, setMarks] = useState('');
  const [annotations, setAnnotations] = useState<AnnotationData>({ annotations: [] });
  const [showMs, setShowMs] = useState(false);
  const [showPages, setShowPages] = useState(false);
  const [showAi, setShowAi] = useState(false);
  const [showOcr, setShowOcr] = useState(false);
  const [ocrText, setOcrText] = useState<string | null>(null);

  const clipQ = useQuery({
    queryKey: ['clip-queue', examId, questionId],
    queryFn: () => api.getNextClip(examId!, questionId!),
    refetchOnWindowFocus: false,
  });

  const clip = clipQ.data?.data;
  const question = clip?.question;

  const saveMutation = useMutation({
    mutationFn: () => api.saveMark({
      clip_id: clip!.id,
      marks_awarded: Number(marks),
      annotation_data: annotations,
    }),
    onSuccess: () => {
      setMarks('');
      setAnnotations({ annotations: [] });
      setShowAi(false);
      setShowOcr(false);
      setOcrText(null);
      ocrMutation.reset();
      qc.invalidateQueries({ queryKey: ['clip-queue', examId, questionId] });
      clipQ.refetch();
    },
  });

  const ocrMutation = useMutation({
    mutationFn: (refresh: boolean) => api.runOcr(clip!.id, refresh),
    onSuccess: (r) => setOcrText(r.data.ocr_text),
  });

  const handleAnnotationChange = useCallback((data: AnnotationData) => {
    setAnnotations(data);
  }, []);

  if (clipQ.isLoading) return <div className="p-6 text-slate-500">Loading…</div>;

  if (!clip) {
    return (
      <div className="p-6 text-center">
        <div className="text-2xl mb-2">All done!</div>
        <p className="text-slate-500 mb-4">You've marked all clips for this question.</p>
        <button onClick={() => navigate('/my-exams')} className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700">
          Back to My Exams
        </button>
      </div>
    );
  }

  const maxMarks = question?.max_marks ?? 0;
  const marksNum = Number(marks);
  const marksValid = marks !== '' && !isNaN(marksNum) && marksNum >= 0 && marksNum <= maxMarks;

  return (
    <div className="flex h-full flex-col">
      {/* Header bar */}
      <div className="flex items-center gap-4 border-b border-slate-200 bg-white px-4 py-2">
        <button onClick={() => navigate('/my-exams')} className="text-sm text-indigo-600 hover:underline">← Back</button>
        <div className="font-medium text-slate-700">
          Question {question?.question_number} — max {maxMarks} marks
        </div>
        <div className="ml-auto flex items-center gap-3">
          <span className="text-sm text-slate-500">{clip.remaining} remaining</span>
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
      <div className="flex min-h-0 flex-1 gap-4 overflow-auto p-4">
        {/* Annotation area */}
        <div className="min-w-0 flex-1 overflow-auto">
          <AnnotationCanvas
            clipUrl={clip.clip_url}
            initialData={annotations}
            onChange={handleAnnotationChange}
          />
        </div>

        {/* Side panels */}
        {((showMs && clip.ms_url) || showAi || showOcr) && (
          <div className="w-80 flex-shrink-0 space-y-3">
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
                    onClick={() => setMarks(String(clip.ai_mark!.marks_awarded))}
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
      <div className="border-t border-slate-200 bg-white px-4 py-3 flex items-center gap-4">
        <div className="flex items-center gap-2">
          <label className="text-sm font-medium text-slate-700">Marks:</label>
          <input
            type="number"
            min={0}
            max={maxMarks}
            value={marks}
            onChange={(e) => setMarks(e.target.value)}
            className="w-20 rounded border border-slate-300 px-2 py-1.5 text-center text-sm font-medium focus:border-indigo-500 focus:outline-none"
            placeholder={`0–${maxMarks}`}
          />
          <span className="text-sm text-slate-400">/ {maxMarks}</span>
        </div>

        {saveMutation.error && (
          <span className="text-sm text-red-600">{(saveMutation.error as Error).message}</span>
        )}

        <div className="ml-auto flex gap-2">
          <button
            onClick={() => saveMutation.mutate()}
            disabled={!marksValid || saveMutation.isPending}
            className="rounded-lg bg-indigo-600 px-5 py-2 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-50"
          >
            {saveMutation.isPending ? 'Saving…' : 'Save & Next →'}
          </button>
        </div>
      </div>

      {showPages && question && (
        <ScriptClipEditor
          scriptId={clip.script_id}
          questionId={question.id}
          questionNumber={question.question_number}
          defaultRegions={question.clip_coordinates}
          defaultNameZones={question.name_zones}
          onClose={() => setShowPages(false)}
          onSaved={() => {
            setShowPages(false);
            setAnnotations({ annotations: [] });
            setOcrText(null);
            ocrMutation.reset();
            clipQ.refetch();
          }}
        />
      )}
    </div>
  );
}
