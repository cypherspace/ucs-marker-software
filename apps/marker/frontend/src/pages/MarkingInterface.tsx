import { useState, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '../api';
import { AnnotationCanvas } from '../components/AnnotationCanvas';
import type { AnnotationData } from '@marker/shared-types';

export function MarkingInterface() {
  const { examId, questionId } = useParams<{ examId: string; questionId: string }>();
  const navigate = useNavigate();
  const qc = useQueryClient();

  const [marks, setMarks] = useState('');
  const [annotations, setAnnotations] = useState<AnnotationData>({ annotations: [] });
  const [showMs, setShowMs] = useState(false);
  const [scriptUrl, setScriptUrl] = useState<string | null>(null);
  const [showScript, setShowScript] = useState(false);

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
      qc.invalidateQueries({ queryKey: ['clip-queue', examId, questionId] });
      clipQ.refetch();
    },
  });

  const handleAnnotationChange = useCallback((data: AnnotationData) => {
    setAnnotations(data);
  }, []);

  async function handleViewScript() {
    if (!clip) return;
    const result = await api.getScriptUrl(clip.id);
    setScriptUrl(result.data.url);
    setShowScript(true);
  }

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
            onClick={() => setShowMs((v) => !v)}
            className={`rounded px-3 py-1 text-xs font-medium transition-colors ${showMs ? 'bg-amber-100 text-amber-700' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'}`}
          >
            {showMs ? 'Hide MS' : 'Show MS'}
          </button>
          <button
            onClick={handleViewScript}
            className="rounded px-3 py-1 text-xs font-medium bg-slate-100 text-slate-600 hover:bg-slate-200"
          >
            View Full Script
          </button>
        </div>
      </div>

      {/* Main content */}
      <div className="flex min-h-0 flex-1 gap-4 overflow-auto p-4">
        {/* Annotation area */}
        <div className="flex-1 min-w-0">
          <AnnotationCanvas
            clipUrl={clip.clip_url}
            initialData={annotations}
            onChange={handleAnnotationChange}
          />
        </div>

        {/* MS panel */}
        {showMs && clip.ms_url && (
          <div className="w-80 flex-shrink-0 rounded-lg border border-amber-200 bg-amber-50 p-2">
            <div className="mb-1 text-xs font-medium text-amber-700 uppercase tracking-wide">Mark Scheme</div>
            <img src={clip.ms_url} alt="Mark scheme" className="w-full rounded" />
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

      {/* Full script modal */}
      {showScript && scriptUrl && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60" onClick={() => setShowScript(false)}>
          <div className="relative max-h-[90vh] w-[80vw] overflow-auto rounded-lg bg-white shadow-xl" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between border-b border-slate-200 px-4 py-2">
              <span className="font-medium text-slate-700">Full Script</span>
              <button onClick={() => setShowScript(false)} className="text-slate-400 hover:text-slate-600">✕</button>
            </div>
            <iframe src={scriptUrl} className="h-[80vh] w-full" title="Full student script" />
          </div>
        </div>
      )}
    </div>
  );
}
