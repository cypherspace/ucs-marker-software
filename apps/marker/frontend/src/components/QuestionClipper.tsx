import { useRef, useState } from 'react';
import type { ClipRegion, ExamQuestion } from '@marker/shared-types';
import { api } from '../api';
import { Button } from './ui';
import { ScriptClipEditor } from './ScriptClipEditor';
import {
  CoordinatePicker, fromQuestionRegions, toClipRegions, toNameZones,
  type DrawnRegion, type RegionType,
} from './CoordinatePicker';

// One drawing window, three jobs:
//  add          type a question number and marks, draw its region on a real script, then straight on to the
//               next question, until Save.
//  edit         change the regions of one existing question.
//  mark-scheme  draw each question's region on the real mark scheme PDF, question after question.

export type ClipperMode = 'add' | 'edit' | 'mark-scheme';

export interface ClipperResult {
  added?: number;
  changedQuestion?: ExamQuestion;
  msClipped?: number;
  msError?: string;
}

interface Props {
  examId: string;
  mode: ClipperMode;
  scripts: { id: string; student_number: string }[];
  questions: ExamQuestion[];
  // edit: the question to change; mark-scheme: the question to start on
  question?: ExamQuestion;
  // mark-scheme: changes when the PDF is replaced, so the pages reload
  markSchemeKey?: string;
  // Called after any save, so the lists behind this window stay current
  onChanged: () => void;
  // Called once, when the window closes
  onFinish: (result: ClipperResult) => void;
}

const strip = (rs: DrawnRegion[]) =>
  rs.map(({ type, page, x, y, width, height }) => [type, page, Math.round(x), Math.round(y), Math.round(width), Math.round(height)]);

// 1 -> 2, 1a -> 1b; anything else is left for the teacher to type
export function suggestNextNumber(last: string | undefined): string {
  if (!last) return '1';
  if (/^\d+$/.test(last)) return String(Number(last) + 1);
  const m = last.match(/^(\d+)([a-y])$/i);
  return m ? `${m[1]}${String.fromCharCode(m[2].charCodeAt(0) + 1)}` : '';
}

const msRegionsOf = (q: ExamQuestion | undefined): DrawnRegion[] =>
  q ? fromQuestionRegions({ ms_clip_coordinates: q.ms_clip_coordinates }) : [];

const questionRegionsOf = (q: ExamQuestion): DrawnRegion[] =>
  fromQuestionRegions({ clip_coordinates: q.clip_coordinates, name_zones: q.name_zones });

export function QuestionClipper(props: Props) {
  const { examId, mode, scripts, questions, question, onChanged, onFinish } = props;

  // ── What to draw on ───────────────────────────────────────────────────────
  const [templateScriptId, setTemplateScriptId] = useState(scripts[0]?.id ?? '');
  const onMarkScheme = mode === 'mark-scheme';
  const sourceKey = onMarkScheme ? `ms-${props.markSchemeKey ?? examId}` : templateScriptId;
  const loadPage = onMarkScheme
    ? (p: number) => api.fetchMarkSchemePage(examId, p)
    : (p: number) => api.fetchScriptPage(templateScriptId, p);

  // ── Mark-scheme mode: which question, and the regions saved so far ────────
  const [msIndex, setMsIndex] = useState(() => {
    const i = question ? questions.findIndex((q) => q.id === question.id) : questions.findIndex((q) => !(q.ms_clip_coordinates ?? []).length);
    return Math.max(0, i);
  });
  const [msSaved, setMsSaved] = useState<Record<string, ClipRegion[]>>(
    () => Object.fromEntries(questions.map((q) => [q.id, q.ms_clip_coordinates ?? []])),
  );
  const msQuestion = onMarkScheme ? questions[msIndex] : undefined;

  // ── Add mode: the question being typed, and the ones already added ────────
  const [number, setNumber] = useState(() => suggestNextNumber(questions[questions.length - 1]?.question_number));
  const [marks, setMarks] = useState('');
  const [added, setAdded] = useState<{ number: string; marks: number }[]>([]);
  const addedCount = useRef(0);
  // The name zone is normally in the same place on every question, so carry it forward
  const nameZones = useRef<DrawnRegion[]>(
    mode === 'add'
      ? fromQuestionRegions({ name_zones: questions[questions.length - 1]?.name_zones ?? null })
      : [],
  );

  // ── Drawing state ─────────────────────────────────────────────────────────
  const firstRegions = (): DrawnRegion[] => {
    if (mode === 'add') return nameZones.current.map((r) => ({ ...r }));
    if (mode === 'edit') return question ? questionRegionsOf(question) : [];
    return msRegionsOf(msQuestion);
  };
  const [regions, setRegions] = useState<DrawnRegion[]>(firstRegions);
  const baseline = useRef(strip(regions));
  const [epoch, setEpoch] = useState(0); // a new epoch remounts the canvas with fresh regions
  const [page, setPage] = useState(() => regions.find((r) => r.type !== 'name_zone')?.page ?? 1);
  const [pageCount, setPageCount] = useState<number | null>(null);
  const [activeType, setActiveType] = useState<RegionType>(onMarkScheme ? 'ms' : 'question');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [scriptOnly, setScriptOnly] = useState(false);

  const mainType: RegionType = onMarkScheme ? 'ms' : 'question';
  const drawn = regions.filter((r) => r.type === mainType);
  const dirty = JSON.stringify(strip(regions)) !== JSON.stringify(baseline.current);
  // In add mode a question is "in progress" once something has been drawn or a mark typed
  const hasWork = mode === 'add' ? drawn.length > 0 || marks !== '' : dirty;

  function showRegions(next: DrawnRegion[], jumpToFirst = false) {
    setRegions(next);
    baseline.current = strip(next);
    setEpoch((e) => e + 1);
    if (jumpToFirst) setPage(next.find((r) => r.type === mainType)?.page ?? 1);
  }

  // ── Add mode ──────────────────────────────────────────────────────────────
  function problemWithNewQuestion(): string | null {
    const n = number.trim();
    if (!n) return 'Enter the question number, for example 1 or 2a.';
    if (questions.some((q) => q.question_number === n) || added.some((a) => a.number === n)) {
      return `Question ${n} already exists. Use a different number.`;
    }
    const m = Number(marks);
    if (marks === '' || !Number.isInteger(m) || m < 1 || m > 100) return 'Enter the marks for this question, a whole number from 1 to 100.';
    if (drawn.length === 0) return 'Draw at least one region around the question on the page.';
    return null;
  }

  // Create the question being typed. Returns false (with the reason shown) if it could not be added.
  async function addCurrent(): Promise<boolean> {
    const problem = problemWithNewQuestion();
    if (problem) { setError(problem); return false; }
    setBusy(true);
    setError(null);
    try {
      await api.createQuestion(examId, {
        question_number: number.trim(),
        max_marks: Number(marks),
        clip_coordinates: toClipRegions(regions, 'question'),
        name_zones: toNameZones(regions),
      });
    } catch (e) {
      setError((e as Error).message);
      return false;
    } finally {
      setBusy(false);
    }
    addedCount.current += 1;
    setAdded((a) => [...a, { number: number.trim(), marks: Number(marks) }]);
    nameZones.current = regions.filter((r) => r.type === 'name_zone');
    setNumber(suggestNextNumber(number.trim()));
    setMarks('');
    showRegions(nameZones.current.map((r) => ({ ...r })));
    onChanged();
    return true;
  }

  async function saveAdd() {
    if (hasWork && !(await addCurrent())) return;
    onFinish({ added: addedCount.current });
  }

  // ── Edit mode ─────────────────────────────────────────────────────────────
  async function saveEdit() {
    if (!question) return;
    setBusy(true);
    setError(null);
    try {
      await api.updateQuestion(examId, question.id, {
        clip_coordinates: toClipRegions(regions, 'question'),
        name_zones: toNameZones(regions),
      });
    } catch (e) {
      setError((e as Error).message);
      setBusy(false);
      return;
    }
    setBusy(false);
    onChanged();
    onFinish({ changedQuestion: question });
  }

  // ── Mark-scheme mode ──────────────────────────────────────────────────────
  // Save the regions drawn for the current question (nothing is sent if they did not change)
  async function saveMs(): Promise<boolean> {
    if (!msQuestion || !dirty) return true;
    setBusy(true);
    setError(null);
    try {
      const coords = toClipRegions(regions, 'ms');
      await api.updateQuestion(examId, msQuestion.id, { ms_clip_coordinates: coords });
      setMsSaved((s) => ({ ...s, [msQuestion.id]: coords }));
      baseline.current = strip(regions);
      onChanged();
      return true;
    } catch (e) {
      setError((e as Error).message);
      return false;
    } finally {
      setBusy(false);
    }
  }

  async function goToMsQuestion(index: number) {
    if (index < 0 || index >= questions.length || index === msIndex) return;
    if (!(await saveMs())) return;
    setMsIndex(index);
    const q = questions[index];
    const coords = msSaved[q.id] ?? q.ms_clip_coordinates ?? [];
    showRegions(msRegionsOf({ ...q, ms_clip_coordinates: coords }), true);
    setError(null);
  }

  async function finishMs() {
    if (!(await saveMs())) return;
    setBusy(true);
    try {
      const r = await api.clipMarkScheme(examId);
      onFinish({ msClipped: r.data.ms_clips_created });
    } catch (e) {
      // The regions are saved; only the clipping step failed, and Generate Clips will try again
      onFinish({ msError: (e as Error).message });
    }
  }

  // ── Closing ───────────────────────────────────────────────────────────────
  function close() {
    if (hasWork && !window.confirm(mode === 'add' ? 'Discard the question you were adding?' : 'Discard the changes you made to these regions?')) return;
    onFinish(mode === 'add' ? { added: addedCount.current } : {});
  }

  // ── Layout ────────────────────────────────────────────────────────────────
  const title = mode === 'add' ? 'Add questions'
    : mode === 'edit' ? `Regions: Q${question?.question_number ?? ''}`
    : `Mark scheme: Q${msQuestion?.question_number ?? ''}`;
  const lastPage = pageCount ?? Infinity;
  const pagesWithRegions = new Set(regions.filter((r) => r.type === mainType).map((r) => r.page));
  const noSource = onMarkScheme ? false : !templateScriptId;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" onClick={close}>
      <div
        role="dialog"
        aria-label={title}
        className="flex max-h-[94vh] w-full max-w-5xl flex-col overflow-hidden rounded-lg bg-white shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex flex-wrap items-center gap-3 border-b border-slate-200 px-4 py-2.5">
          <span className="font-medium text-slate-700">{title}</span>

          {!onMarkScheme && (
            <div className="flex items-center gap-1 rounded-lg border border-slate-200 p-0.5 text-xs">
              {([['question', 'Question'], ['name_zone', 'Name zone']] as [RegionType, string][]).map(([t, label]) => (
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

          {onMarkScheme ? (
            <span className="rounded bg-amber-50 px-2 py-0.5 text-xs font-medium text-amber-800">Showing the mark scheme</span>
          ) : scripts.length > 1 ? (
            <select
              value={templateScriptId}
              onChange={(e) => { setTemplateScriptId(e.target.value); setPageCount(null); setPage(1); }}
              className="rounded border border-slate-300 px-2 py-1 text-xs"
              title="Script used as the layout template"
              aria-label="Template script"
            >
              {scripts.map((s) => <option key={s.id} value={s.id}>Script {s.student_number}</option>)}
            </select>
          ) : scripts.length === 1 ? (
            <span className="text-xs text-slate-500">Script {scripts[0].student_number}</span>
          ) : null}

          {mode === 'edit' && templateScriptId && (
            <button
              onClick={() => setScriptOnly(true)}
              title="Choose different pages or areas for just the selected script, e.g. a typed or scribed paper, or one with pages missing"
              className="rounded border border-slate-300 bg-white px-2.5 py-1 text-xs font-medium text-slate-700 hover:bg-slate-50"
            >
              Clip this script differently…
            </button>
          )}

          <button onClick={close} aria-label="Close" className="ml-auto text-slate-400 hover:text-slate-600">✕</button>
        </div>

        {/* Add mode: the question being added */}
        {mode === 'add' && (
          <div className="flex flex-wrap items-center gap-3 border-b border-slate-200 bg-slate-50 px-4 py-2 text-sm">
            <label className="flex items-center gap-1.5 text-slate-600">
              Question
              <input
                type="text"
                value={number}
                onChange={(e) => setNumber(e.target.value)}
                placeholder="e.g. 1a"
                aria-label="Question number"
                className="w-20 rounded border border-slate-300 px-2 py-1 focus:border-indigo-500 focus:outline-none"
              />
            </label>
            <label className="flex items-center gap-1.5 text-slate-600">
              <input
                type="number"
                min={1}
                max={100}
                value={marks}
                onChange={(e) => setMarks(e.target.value)}
                placeholder="Marks"
                aria-label="Marks for this question"
                className="w-20 rounded border border-slate-300 px-2 py-1 focus:border-indigo-500 focus:outline-none"
              />
              marks
            </label>
            <span className="text-xs text-slate-500">
              {drawn.length > 0 ? `${drawn.length} region${drawn.length === 1 ? '' : 's'} drawn` : 'Now draw the question on the page'}
            </span>
            {added.length > 0 && (
              <span className="ml-auto flex flex-wrap items-center gap-1 text-xs" aria-label="Questions added so far">
                {added.map((a) => (
                  <span key={a.number} className="rounded-full bg-green-100 px-2 py-0.5 font-medium text-green-700">
                    Q{a.number} · {a.marks}
                  </span>
                ))}
              </span>
            )}
          </div>
        )}

        {/* Mark-scheme mode: pick the question */}
        {onMarkScheme && (
          <div className="flex flex-wrap items-center gap-1.5 border-b border-slate-200 bg-slate-50 px-4 py-2 text-xs" aria-label="Questions">
            <span className="mr-1 text-slate-500">Question:</span>
            {questions.map((q, i) => {
              const has = (msSaved[q.id] ?? []).length > 0;
              return (
                <button
                  key={q.id}
                  onClick={() => void goToMsQuestion(i)}
                  disabled={busy}
                  aria-current={i === msIndex}
                  className={`rounded-full border px-2.5 py-1 font-medium transition-colors ${
                    i === msIndex
                      ? 'border-indigo-600 bg-indigo-600 text-white'
                      : has ? 'border-green-200 bg-green-50 text-green-700 hover:bg-green-100'
                      : 'border-slate-300 bg-white text-slate-600 hover:bg-slate-100'
                  }`}
                >
                  Q{q.question_number}{has ? ' ✓' : ''}
                </button>
              );
            })}
          </div>
        )}

        {/* Canvas */}
        <div className="min-h-0 flex-1 overflow-auto p-4">
          {noSource ? (
            <div className="text-sm text-slate-500">No script available to draw on. Upload a script first.</div>
          ) : onMarkScheme && !msQuestion ? (
            <div className="text-sm text-slate-500">Add some questions first, then come back to draw their mark-scheme regions.</div>
          ) : (
            <CoordinatePicker
              key={`${sourceKey}-${epoch}`}
              sourceKey={sourceKey}
              loadPage={loadPage}
              page={page}
              initialRegions={regions}
              onRegionsChange={setRegions}
              activeType={activeType}
              onPageCount={(n) => { setPageCount(n); setPage((p) => Math.min(p, n)); }}
              onRequestPage={setPage}
            />
          )}
        </div>

        {/* Footer */}
        <div className="flex flex-wrap items-center gap-3 border-t border-slate-200 px-4 py-2.5">
          <span className="min-w-0 flex-1 text-xs text-slate-500">
            {mode === 'add' && 'Draw the question on the page (use several pages if it runs over), then Add question to start the next one. Save when you have finished.'}
            {mode === 'edit' && 'Drag on the page to draw a region. Move between pages to add regions on several pages; they are stitched into one image at clip time.'}
            {onMarkScheme && 'Draw the part of the mark scheme that answers this question. Save & next question moves on; Save & finish clips the mark scheme.'}
          </span>
          {error && <span role="alert" className="text-xs text-red-600">{error}</span>}

          {mode === 'add' && (
            <div className="flex gap-2">
              <Button onClick={close} disabled={busy}>Cancel</Button>
              <Button onClick={() => void addCurrent()} disabled={busy} title="Save this question and start the next one">
                {busy ? 'Adding…' : 'Add question'}
              </Button>
              <Button variant="primary" onClick={() => void saveAdd()} disabled={busy || (!hasWork && added.length === 0)}>
                {busy ? 'Saving…' : 'Save'}
              </Button>
            </div>
          )}
          {mode === 'edit' && (
            <div className="flex gap-2">
              <Button onClick={close} disabled={busy}>Cancel</Button>
              <Button variant="primary" onClick={() => void saveEdit()} disabled={busy}>
                {busy ? 'Saving…' : 'Save regions'}
              </Button>
            </div>
          )}
          {onMarkScheme && (
            <div className="flex gap-2">
              <Button onClick={() => void goToMsQuestion(msIndex - 1)} disabled={busy || msIndex === 0}>← Previous</Button>
              <Button onClick={() => void goToMsQuestion(msIndex + 1)} disabled={busy || msIndex >= questions.length - 1}>
                Save &amp; next question
              </Button>
              <Button variant="primary" onClick={() => void finishMs()} disabled={busy || !msQuestion}>
                {busy ? 'Working…' : 'Save & finish'}
              </Button>
            </div>
          )}
        </div>
      </div>

      {scriptOnly && question && templateScriptId && (
        <ScriptClipEditor
          scriptId={templateScriptId}
          scriptLabel={`Script ${scripts.find((s) => s.id === templateScriptId)?.student_number ?? ''}`}
          questionId={question.id}
          questionNumber={question.question_number}
          defaultRegions={question.clip_coordinates}
          defaultNameZones={question.name_zones}
          onClose={() => setScriptOnly(false)}
          onSaved={() => { setScriptOnly(false); onChanged(); }}
        />
      )}
    </div>
  );
}
