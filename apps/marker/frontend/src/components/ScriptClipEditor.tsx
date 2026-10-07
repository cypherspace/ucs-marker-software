import { useState, type ReactNode } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { ClipRegion, ClipSettings, NameZone } from '@marker/shared-types';
import { api } from '../api';
import { Button } from './ui';
import {
  CoordinatePicker, fromQuestionRegions, toClipRegions, toNameZones,
  type DrawnRegion, type RegionType,
} from './CoordinatePicker';

interface Props {
  scriptId: string;
  scriptLabel?: string;
  questionId: string;
  questionNumber: string;
  // The question's standard regions, used as the starting point until this script has its own
  defaultRegions: ClipRegion[] | null;
  defaultNameZones: NameZone[] | null;
  onClose: () => void;
  onSaved: () => void;
}

const strip = (rs: DrawnRegion[]) => rs.map(({ type, page, x, y, width, height }) => ({ type, page, x, y, width, height }));

// Page through one student's script and choose the pages/areas that hold the answer to one question.
// Only this script's clip changes; the question's standard regions are untouched.
export function ScriptClipEditor(props: Props) {
  const settingsQ = useQuery({
    queryKey: ['clip-settings', props.scriptId, props.questionId],
    queryFn: () => api.getClipSettings(props.scriptId, props.questionId),
    gcTime: 0,
  });

  if (settingsQ.isLoading) {
    return (
      <Shell onClose={props.onClose} title={`Pages for Q${props.questionNumber}`}>
        <div className="p-6 text-sm text-slate-500">Loading…</div>
      </Shell>
    );
  }
  if (settingsQ.error || !settingsQ.data) {
    return (
      <Shell onClose={props.onClose} title={`Pages for Q${props.questionNumber}`}>
        <div role="alert" className="p-6 text-sm text-red-700">
          {(settingsQ.error as Error | null)?.message ?? 'Could not load this clip.'}
          <Button className="ml-3" onClick={() => settingsQ.refetch()}>Try again</Button>
        </div>
      </Shell>
    );
  }
  return <Editor {...props} settings={settingsQ.data.data} />;
}

function Shell({ title, onClose, children }: { title: string; onClose: () => void; children: ReactNode }) {
  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/60 p-4" onClick={onClose}>
      <div
        role="dialog"
        aria-label={title}
        className="flex max-h-[92vh] w-full max-w-5xl flex-col overflow-hidden rounded-lg bg-white shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        {children}
      </div>
    </div>
  );
}

function Editor({ settings, ...props }: Props & { settings: ClipSettings }) {
  const qc = useQueryClient();
  const canNameZones = settings.can_edit_name_zones;

  const [initial] = useState<DrawnRegion[]>(() => {
    const own = settings.clip_source === 'manual' && settings.regions?.length;
    const drawn = fromQuestionRegions({
      clip_coordinates: own ? settings.regions : props.defaultRegions,
      name_zones: own ? settings.name_zones ?? props.defaultNameZones : props.defaultNameZones,
    });
    // Markers see pages with names already hidden, so name zones are not theirs to show or edit
    return canNameZones ? drawn : drawn.filter((r) => r.type === 'question');
  });
  const [regions, setRegions] = useState<DrawnRegion[]>(initial);
  const [page, setPage] = useState(() => initial.find((r) => r.type === 'question')?.page ?? 1);
  const [pageCount, setPageCount] = useState<number | null>(null);
  const [activeType, setActiveType] = useState<RegionType>('question');

  const dirty = JSON.stringify(strip(regions)) !== JSON.stringify(strip(initial));
  const questionRegions = regions.filter((r) => r.type === 'question');

  function close() {
    if (dirty && !window.confirm('Discard the changes you made to these areas?')) return;
    props.onClose();
  }

  const done = () => {
    qc.invalidateQueries({ queryKey: ['clip-settings', props.scriptId, props.questionId] });
    props.onSaved();
  };

  const save = useMutation({
    mutationFn: () => api.setClipRegions(props.scriptId, props.questionId, {
      regions: toClipRegions(regions, 'question'),
      ...(canNameZones ? { name_zones: toNameZones(regions) } : {}),
    }),
    onSuccess: done,
  });
  const reset = useMutation({
    mutationFn: () => api.resetClipRegions(props.scriptId, props.questionId),
    onSuccess: done,
  });
  const busy = save.isPending || reset.isPending;
  const error = (save.error ?? reset.error) as Error | null;

  const pagesWithRegions = new Set(regions.map((r) => r.page));
  const lastPage = pageCount ?? Infinity;

  return (
    <Shell onClose={close} title={`Pages for question ${props.questionNumber}`}>
      <div className="flex flex-wrap items-center gap-3 border-b border-slate-200 px-4 py-2.5">
        <span className="font-medium text-slate-700">
          Pages for Q{props.questionNumber}{props.scriptLabel ? ` · ${props.scriptLabel}` : ''}
        </span>

        {canNameZones && (
          <div className="flex items-center gap-1 rounded-lg border border-slate-200 p-0.5 text-xs">
            {([['question', 'Answer area'], ['name_zone', 'Name zone']] as [RegionType, string][]).map(([t, label]) => (
              <button
                key={t}
                onClick={() => setActiveType(t)}
                className={`rounded px-2.5 py-1 font-medium transition-colors ${activeType === t ? 'bg-indigo-600 text-white' : 'text-slate-600 hover:bg-slate-100'}`}
              >
                {label}
              </button>
            ))}
          </div>
        )}

        <div className="flex items-center gap-1 text-xs text-slate-600">
          <span>Page</span>
          <button
            onClick={() => setPage((p) => Math.max(1, p - 1))}
            disabled={page <= 1}
            aria-label="Previous page"
            className="rounded bg-slate-100 px-2 py-1 hover:bg-slate-200 disabled:opacity-40"
          >
            −
          </button>
          <span className="relative min-w-[3.5rem] text-center font-medium">
            {page}{pageCount ? ` of ${pageCount}` : ''}
            {pagesWithRegions.has(page) && <span className="absolute -right-1 -top-0.5 h-1.5 w-1.5 rounded-full bg-indigo-500" />}
          </span>
          <button
            onClick={() => setPage((p) => Math.min(lastPage, p + 1))}
            disabled={page >= lastPage}
            aria-label="Next page"
            className="rounded bg-slate-100 px-2 py-1 hover:bg-slate-200 disabled:opacity-40"
          >
            +
          </button>
        </div>

        {settings.clip_source === 'manual' && (
          <span className="rounded-full bg-indigo-50 px-2 py-0.5 text-xs font-medium text-indigo-700">Custom selection in use</span>
        )}

        <button onClick={close} aria-label="Close" className="ml-auto text-slate-400 hover:text-slate-600">✕</button>
      </div>

      <div className="min-h-0 flex-1 overflow-auto p-4">
        <CoordinatePicker
          scriptId={props.scriptId}
          page={page}
          initialRegions={initial}
          onRegionsChange={setRegions}
          activeType={activeType}
          onPageCount={(n) => { setPageCount(n); setPage((p) => Math.min(p, n)); }}
          onRequestPage={setPage}
        />
      </div>

      <div className="flex flex-wrap items-center gap-3 border-t border-slate-200 px-4 py-2.5">
        <span className="max-w-xl text-xs text-slate-500">
          Drag on a page to mark where this student's answer is. Use several pages if it is spread out; they are joined into one image.
          {!canNameZones && ' Student names are hidden on these pages.'}
          {' '}Marks already given are kept but flagged as made on the old selection.
        </span>
        {error && <span role="alert" className="text-xs text-red-600">{error.message}</span>}
        <div className="ml-auto flex gap-2">
          {settings.clip_source === 'manual' && (
            <Button
              variant="danger"
              disabled={busy}
              onClick={() => {
                if (window.confirm('Go back to the standard areas for this question on this script?')) reset.mutate();
              }}
            >
              {reset.isPending ? 'Resetting…' : 'Use standard areas'}
            </Button>
          )}
          <Button onClick={close} disabled={busy}>Cancel</Button>
          <Button
            variant="primary"
            disabled={busy || questionRegions.length === 0 || !dirty}
            onClick={() => save.mutate()}
            title={questionRegions.length === 0 ? 'Draw at least one answer area' : !dirty ? 'Change the areas first' : undefined}
          >
            {save.isPending ? 'Saving…' : 'Use these areas'}
          </Button>
        </div>
      </div>
    </Shell>
  );
}
