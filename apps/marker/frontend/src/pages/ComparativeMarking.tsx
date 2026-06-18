import { useParams, useNavigate } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '../api';

export function ComparativeMarking() {
  const { examId, questionId } = useParams<{ examId: string; questionId: string }>();
  const navigate = useNavigate();
  const qc = useQueryClient();

  const pairQ = useQuery({
    queryKey: ['compare-pair', examId, questionId],
    queryFn: () => api.getNextPair(examId!, questionId!),
  });

  const voteMutation = useMutation({
    mutationFn: (winnerClipId: string) => api.recordComparison(pair!.id, winnerClipId),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['compare-pair', examId, questionId] });
      pairQ.refetch();
    },
  });

  if (pairQ.isLoading) return <div className="p-6 text-slate-500">Loading…</div>;

  const pair = pairQ.data?.data;

  if (!pair) {
    return (
      <div className="p-6 text-center">
        <div className="text-2xl mb-2">Ranking complete!</div>
        <p className="text-slate-500 mb-4">All comparative pairs have been judged.</p>
        <button onClick={() => navigate('/my-exams')} className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700">
          Back to My Exams
        </button>
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center gap-4 border-b border-slate-200 bg-white px-4 py-2">
        <button onClick={() => navigate('/my-exams')} className="text-sm text-indigo-600 hover:underline">← Back</button>
        <div className="font-medium text-slate-700">Comparative Marking</div>
        <div className="ml-auto text-sm text-slate-500">Which response is better?</div>
      </div>

      <div className="flex min-h-0 flex-1 gap-0">
        {/* Script A */}
        <div className="flex flex-1 flex-col border-r border-slate-200">
          <div className="border-b border-slate-200 bg-slate-50 px-4 py-2 text-center text-sm font-medium text-slate-600">
            Script A
          </div>
          <div className="flex-1 overflow-auto p-4">
            {pair.clip_a_image_url ? (
              <img src={pair.clip_a_image_url} alt="Script A" className="max-w-full rounded border border-slate-200" />
            ) : (
              <div className="text-slate-400 text-sm">Image unavailable</div>
            )}
          </div>
          <div className="border-t border-slate-200 p-3">
            <button
              onClick={() => voteMutation.mutate(pair.clip_a_id)}
              disabled={voteMutation.isPending}
              className="w-full rounded-lg bg-green-600 px-4 py-2.5 text-sm font-medium text-white hover:bg-green-700 disabled:opacity-50"
            >
              A is better →
            </button>
          </div>
        </div>

        {/* Middle divider */}
        <div className="flex flex-col items-center justify-center px-2 py-4 text-xs text-slate-400">
          vs
        </div>

        {/* Script B */}
        <div className="flex flex-1 flex-col border-l border-slate-200">
          <div className="border-b border-slate-200 bg-slate-50 px-4 py-2 text-center text-sm font-medium text-slate-600">
            Script B
          </div>
          <div className="flex-1 overflow-auto p-4">
            {pair.clip_b_image_url ? (
              <img src={pair.clip_b_image_url} alt="Script B" className="max-w-full rounded border border-slate-200" />
            ) : (
              <div className="text-slate-400 text-sm">Image unavailable</div>
            )}
          </div>
          <div className="border-t border-slate-200 p-3">
            <button
              onClick={() => voteMutation.mutate(pair.clip_b_id)}
              disabled={voteMutation.isPending}
              className="w-full rounded-lg bg-blue-600 px-4 py-2.5 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
            >
              ← B is better
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
