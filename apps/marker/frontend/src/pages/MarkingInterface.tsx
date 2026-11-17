import { useEffect, useRef, useState, useCallback } from 'react';
import { useParams, useNavigate, useLocation } from 'react-router-dom';
import { ErrorNotice } from '../components/ErrorNotice';
import { useBackTarget } from '../lib/nav';
import { keepPreviousData, useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api, HttpError } from '../api';
import { AnnotationCanvas } from '../components/AnnotationCanvas';
import { AnnotationToolbar, COLORS, TOOLS, type Tool } from '../components/AnnotationToolbar';
import { DockablePanel } from '../components/DockablePanel';
import { ScriptClipEditor } from '../components/ScriptClipEditor';
import { OverlayEditor } from '../components/OverlayEditor';
import { OverlayControls } from '../components/OverlayPanel';
import { useOverlayView } from '../hooks/useOverlayView';
import { normaliseRotation, nudge } from '../lib/overlay';
import { Button } from '../components/ui';
import { ZoomableImage } from '../components/ZoomableImage';
import { ZoomControls } from '../components/ZoomControls';
import { useZoom } from '../hooks/useZoom';
import { annotationMark, isPointType, markTickTotal, nextNumber } from '../lib/annotations';
import { usePersistedState } from '../hooks/usePersistedState';
import { applyDigit, isMarkDigitKey, isSaveEnterKey, type DigitBuffer } from '../lib/markKeys';
import type { Annotation, AnnotationData, QueueClip } from '@marker/shared-types';
import { questionLabel } from '../lib/questionLabel';
import { clearImageCache, preloadImage } from '../lib/clipImageCache';

// Loads one clip (the one in the URL, else the first this teacher hasn't finished).
// Moving to another script keeps the screen as it is (header, tools, mark scheme) and swaps the script in when it is
// ready: the old script stays up, inactive, until the next one's data has arrived, and its image is usually already
// fetched. MarkingPanel resets everything that belongs to one script (ticks, typed mark, converted view) when the clip
// changes, so nothing carries over to another script.
export function MarkingInterface() {
  const { examId, questionId, clipId } = useParams<{ examId: string; questionId: string; clipId?: string }>();
  const navigate = useNavigate();
  const loc = useLocation();
  const backTarget = useBackTarget({ to: '/marking', label: 'Marking' });
  // Moving between scripts keeps the remembered "came from" page, so Back still returns to it.
  const keep = { state: loc.state };

  const clipQ = useQuery({
    queryKey: ['clip-queue', examId, questionId, clipId ?? 'next'],
    queryFn: () => api.getNextClip(examId!, questionId!, clipId),
    refetchOnWindowFocus: false,
    gcTime: 0,
    // Keep showing the current script while the next one's data loads, instead of replacing the screen with "Loading…"
    placeholderData: keepPreviousData,
  });

  // Pictures held for quick moves between scripts are dropped when leaving the marking page (a re-clip elsewhere is then seen)
  useEffect(() => clearImageCache, []);

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
      clip={clip}
      stale={clipQ.isPlaceholderData}
      examId={examId!}
      questionId={questionId!}
      refetch={() => { void clipQ.refetch(); }}
    />
  );
}

const snapshot = (a: AnnotationData, typed: string | null) => JSON.stringify([a.annotations, typed]);

function MarkingPanel({ clip, examId, questionId, refetch, stale }: {
  clip: QueueClip; examId: string; questionId: string; refetch: () => void;
  // The next script is still loading: this one is shown but cannot be acted on
  stale: boolean;
}) {
  const navigate = useNavigate();
  const loc = useLocation();
  const backTarget = useBackTarget({ to: '/marking', label: 'Marking' });
  const qc = useQueryClient();
  const question = clip.question;
  const maxMarks = question.max_marks;

  // Ticks placed on a converted page that has since been discarded have nothing to sit on, so they are dropped
  const savedAnnotations: AnnotationData = clip.my_mark?.annotation_data ?? { annotations: [] };
  const initialAnnotations: AnnotationData = clip.converted_url
    ? savedAnnotations
    : { annotations: savedAnnotations.annotations.filter((a) => a.layer !== 'text') };
  const initialAuto = annotationMark(initialAnnotations);
  // `typed` is null while the Marks box simply follows the annotations (Mark ticks, or a cross for 0);
  // typing a different number overrides them.
  const initialTyped = clip.my_mark?.marks_awarded == null
    ? null
    : (initialAuto !== null && clip.my_mark.marks_awarded === initialAuto ? null : String(clip.my_mark.marks_awarded));

  const [annotations, setAnnotations] = useState<AnnotationData>(initialAnnotations);
  const [typed, setTyped] = useState<string | null>(initialTyped);
  const [saved, setSaved] = useState(() => snapshot(initialAnnotations, initialTyped));
  // These choices are remembered in the browser, so they carry over to the next script
  const [showMs, setShowMs] = usePersistedState<boolean>('marker.ms.open', false, (v): v is boolean => typeof v === 'boolean');
  const [showPages, setShowPages] = useState(false);
  const [showAi, setShowAi] = useState(false);
  // The converted-handwriting page (a saved picture of the transcription), once made
  const [convertedUrl, setConvertedUrl] = useState<string | null>(clip.converted_url);
  const [view, setView] = useState<'script' | 'converted'>('script');
  // Tracing-paper overlay: where it sits, how it looks and whether it is locked is remembered per question (so it stays
  // put from script to script); only the drawing window and which part is being nudged belong to the moment
  const [overlayView, updateOverlayView] = useOverlayView(question.id);
  const [drawingOverlay, setDrawingOverlay] = useState(false);
  // The overlay was just dragged or nudged: the arrow keys carry on moving it (not otherwise, so they still scroll the page)
  const [overlayPicked, setOverlayPicked] = useState(false);
  // The panel with the overlay's controls: open while the overlay is on (until it is closed with its ×), or to make one
  const [overlayPanelHidden, setOverlayPanelHidden] = usePersistedState<boolean>('marker.overlay.panel.hidden', false, (v): v is boolean => typeof v === 'boolean');
  const [overlayCreateOpen, setOverlayCreateOpen] = useState(false);
  const overlayData = question.overlay_data ?? null;
  const overlayOn = Boolean(overlayData) && overlayView.show;
  const overlayPanelOpen = overlayData ? overlayOn && !overlayPanelHidden : overlayCreateOpen;

  // This panel stays mounted from script to script. When the script changes, everything that belongs to one script
  // starts again from what is saved for the new one (so ticks, a typed mark or the converted view never carry over).
  const [shownClipId, setShownClipId] = useState(clip.id);
  if (shownClipId !== clip.id) {
    setShownClipId(clip.id);
    setAnnotations(initialAnnotations);
    setTyped(initialTyped);
    setSaved(snapshot(initialAnnotations, initialTyped));
    setShowPages(false);
    setShowAi(false);
    setConvertedUrl(clip.converted_url);
    setView('script');
    setOverlayPicked(false);
  }
  const [tool, setTool] = usePersistedState<Tool>('marker.tool', 'mark_tick', (v): v is Tool => TOOLS.includes(v as Tool));
  const [color, setColor] = usePersistedState<string>('marker.color', COLORS[0], (v): v is string => COLORS.includes(v as string));
  // Dragging works with the tick tools; the circle, underline, ruler and text tools drag on the script themselves
  const canDragOverlay = isPointType(tool) || tool === 'erase';
  const scriptZoom = useZoom('marker.zoom.script');
  const convertedZoom = useZoom('marker.zoom.converted');
  const zoomState = view === 'converted' ? convertedZoom : scriptZoom;
  // Each picture has its own set of annotations; ticks on both count towards the same mark
  const layer = view === 'converted' ? 'text' : 'clip';
  const onLayer = (a: Annotation) => (a.layer ?? 'clip') === layer;

  const ticks = markTickTotal(annotations);
  const auto = annotationMark(annotations); // from the Mark ticks, or 0 if crossed
  const marks = typed ?? (auto !== null ? String(auto) : '');
  const marksNum = Number(marks);
  const marksValid = marks !== '' && Number.isInteger(marksNum) && marksNum >= 0 && marksNum <= maxMarks;
  // An empty Marks box is a real answer when saving: nothing earned, recorded as 0. (Drafts left behind when you
  // move on stay blank, so they never count as marked.)
  const blank = marks === '';
  const canSave = marksValid || blank;
  const overriding = typed !== null && auto !== null && typed !== String(auto);
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
      marks_awarded: marksValid ? marksNum : (!draft && blank ? 0 : null),
      annotation_data: annotations,
      draft,
    }),
    onSuccess: () => {
      setSaved(snapshot(annotations, typed));
      void qc.invalidateQueries({ queryKey: ['clip-list', examId, questionId] });
    },
  });

  // Convert the handwriting to text once: the text and its page image are saved on the clip, so asking
  // again returns them. `refresh` converts afresh and drops ticks made on the old converted page.
  const convertMutation = useMutation({
    mutationFn: (refresh: boolean) => api.runOcr(clip.id, refresh),
    onSuccess: (r, refresh) => {
      setConvertedUrl(r.data.converted_url);
      if (refresh) setAnnotations((d) => ({ annotations: d.annotations.filter((a) => a.layer !== 'text') }));
      setView('converted');
    },
  });

  function convertAgain() {
    if (window.confirm(
      'Convert this handwriting again?\n\nThe text is read afresh, and any ticks or notes you placed on the '
      + 'converted page are removed (including mark ticks, so check the mark afterwards). '
      + 'Your marks on the original script are kept.',
    )) convertMutation.mutate(true);
  }

  useEffect(() => {
    saveMutation.reset();
    convertMutation.reset();
    digits.current = { text: '', at: 0 };
    setFlash(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clip.id]);

  // Fetch the pictures of the scripts likely to come next, once this one is on screen
  useEffect(() => {
    if (stale) return;
    const timer = setTimeout(() => { for (const url of clip.preload_urls ?? []) void preloadImage(url).catch(() => {}); }, 300);
    return () => clearTimeout(timer);
  }, [clip.id, clip.preload_urls, stale]);

  const addAnnotation = useCallback(
    (a: Annotation) => setAnnotations((d) => ({ annotations: [...d.annotations, a] })), []);
  const removeAnnotation = useCallback(
    (id: string) => setAnnotations((d) => ({ annotations: d.annotations.filter((a) => a.id !== id) })), []);
  // Undo takes back the last annotation on the picture you are looking at
  const undoAnnotation = () => setAnnotations((d) => {
    const i = d.annotations.map(onLayer).lastIndexOf(true);
    return i < 0 ? d : { annotations: d.annotations.filter((_, j) => j !== i) };
  });

  // Typing a number anywhere on the page sets the mark (unless the Text tool is selected or a field has focus).
  // Backspace / Delete clears a typed mark so the Marks box follows the annotations again.
  const digits = useRef<DigitBuffer>({ text: '', at: 0 });
  // Enter saves the mark and moves to the next clip, the same as the Save & Next button
  const saveNext = useRef<() => void>(() => {});
  const [flash, setFlash] = useState(false);
  useEffect(() => {
    if (showPages || stale || drawingOverlay) return;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      const inField = t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable);
      if (isSaveEnterKey(e, tool)) {
        e.preventDefault();
        if (canSave && !saveMutation.isPending) saveNext.current();
        return;
      }
      if ((e.key === 'Backspace' || e.key === 'Delete') && !inField && tool !== 'text' && typed !== null) {
        e.preventDefault();
        digits.current = { text: '', at: 0 };
        setTyped(null);
        return;
      }
      if (!isMarkDigitKey(e, tool)) return;
      e.preventDefault();
      const now = Date.now();
      const next = applyDigit(digits.current, e.key, now, maxMarks);
      digits.current = { text: next, at: now };
      setTyped(auto !== null && next === String(auto) ? null : next);
      setFlash(true);
      clearTimeout(timer);
      timer = setTimeout(() => setFlash(false), 500);
    };
    window.addEventListener('keydown', onKey);
    return () => { window.removeEventListener('keydown', onKey); clearTimeout(timer); };
  }, [tool, maxMarks, auto, typed, showPages, stale, drawingOverlay, canSave, saveMutation.isPending]);

  // After the overlay has been dragged or nudged, the arrow keys move it a little more (Shift for bigger steps); Esc stops that
  useEffect(() => {
    if (!overlayPicked || !overlayOn || overlayView.locked) return;
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable)) return;
      if (e.key === 'Escape') { setOverlayPicked(false); return; }
      const step = e.shiftKey ? 10 : 1;
      const d: Record<string, [number, number]> = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] };
      const m = d[e.key];
      if (!m) return;
      e.preventDefault();
      updateOverlayView((v) => nudge(v, m[0], m[1]));
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [overlayPicked, overlayOn, overlayView.locked, updateOverlayView]);

  // Esc leaves the converted view
  useEffect(() => {
    if (view !== 'converted') return;
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (e.key === 'Escape' && !(t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA'))) setView('script');
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [view]);

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
  saveNext.current = () => { void saveAndNext(); };

  const list = listQ.data?.data ?? [];
  const statusText = saveMutation.isPending ? 'Saving…'
    : dirty ? 'Unsaved changes'
    : saveMutation.isSuccess ? (saveMutation.variables ? 'Draft saved' : 'Saved')
    : clip.state === 'marked' ? 'Saved'
    : clip.state === 'draft' ? 'Draft saved'
    : '';

  return (
    <div className="flex h-full flex-col" inert={stale} aria-busy={stale}>
      {/* Header bar */}
      <div className="flex flex-wrap items-center gap-3 border-b border-slate-200 bg-white px-4 py-2">
        <button onClick={async () => { if (dirty) { try { await saveMutation.mutateAsync(true); } catch { return; } } navigate(backTarget.to, { state: backTarget.state }); }}
          className="text-sm font-medium text-indigo-600 hover:underline">← Back to {backTarget.label}</button>
        <span className="rounded bg-slate-200 px-2 py-0.5 text-xs font-semibold text-slate-700" title={`Question ${questionLabel(question.question_number)}`}>
          Q{questionLabel(question.question_number)}
        </span>

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
          <span className="text-sm text-slate-500">{clip.remaining} to mark</span>
          <ZoomControls
            zoom={zoomState.zoom} onZoomIn={zoomState.zoomIn} onZoomOut={zoomState.zoomOut} onFit={zoomState.fit}
            label={view === 'converted' ? 'Converted page zoom' : 'Script zoom'}
          />
          {convertedUrl ? (
            <button
              onClick={() => setView((v) => (v === 'converted' ? 'script' : 'converted'))}
              aria-pressed={view === 'converted'}
              title="The handwriting as typed text, saved so it is only converted once. You can mark it just like the script."
              className={`rounded px-3 py-1 text-xs font-medium transition-colors ${view === 'converted' ? 'bg-sky-100 text-sky-700' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'}`}
            >
              {view === 'converted' ? 'Back to script' : 'See converted handwriting'}
            </button>
          ) : (
            <button
              onClick={() => convertMutation.mutate(false)}
              disabled={convertMutation.isPending}
              title="Read the handwriting and show it as typed text you can mark. Done once, then saved."
              className="rounded bg-slate-100 px-3 py-1 text-xs font-medium text-slate-600 transition-colors hover:bg-slate-200 disabled:opacity-60"
            >
              {convertMutation.isPending ? 'Converting…' : 'Convert handwriting to text'}
            </button>
          )}
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
            onClick={() => setShowMs(!showMs)}
            disabled={!clip.ms_url}
            title={clip.ms_url ? 'Show or hide the mark scheme. Drag its title bar to move it.' : 'No mark scheme has been clipped for this question'}
            aria-pressed={showMs}
            className={`rounded px-3 py-1 text-xs font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${showMs ? 'bg-amber-100 text-amber-700' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'}`}
          >
            {showMs ? 'Hide MS' : 'Show MS'}
          </button>
          <button
            type="button"
            onClick={() => {
              if (!overlayData) { setOverlayCreateOpen(!overlayCreateOpen); return; }
              // On: shown with its controls; off: hidden
              updateOverlayView({ show: !overlayView.show });
              if (!overlayView.show) setOverlayPanelHidden(false);
            }}
            aria-pressed={overlayOn}
            title="Tracing-paper overlay: lay the correct graph or picture over the script"
            className={`rounded px-3 py-1 text-xs font-medium transition-colors ${overlayOn ? 'bg-rose-100 text-rose-700' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'}`}
          >
            {overlayOn ? 'Overlay on' : 'Overlay'}
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

      {convertMutation.error && (
        <ErrorNotice error={convertMutation.error} onRetry={() => convertMutation.mutate(convertMutation.variables ?? false)} />
      )}

      {clip.changed_after_marking && (
        <div role="status" className="border-b border-amber-200 bg-amber-50 px-4 py-2 text-sm text-amber-800">
          The pages for this answer were changed after it was first marked, so earlier marks may refer to the old selection.
        </div>
      )}

      {/* Main content: the script with its tools; the mark scheme docks around it */}
      <DockablePanel
        title="Mark scheme"
        storageKey="marker.panel.ms"
        open={showMs && Boolean(clip.ms_url)}
        onClose={() => setShowMs(false)}
        panel={clip.ms_url ? <ZoomableImage src={clip.ms_url} alt="Mark scheme" storageKey="marker.zoom.ms" /> : null}
      >
      <DockablePanel
        title="Overlay"
        tone="rose"
        defaults={{ mode: 'right', w: 300 }}
        storageKey="marker.panel.overlay"
        open={overlayPanelOpen}
        onClose={() => { if (overlayData) setOverlayPanelHidden(true); else setOverlayCreateOpen(false); }}
        panel={(
          <OverlayControls
            examId={examId}
            questionId={question.id}
            hasOverlay={Boolean(overlayData)}
            view={overlayView}
            onChange={updateOverlayView}
            canDrag={canDragOverlay}
            onNudged={() => setOverlayPicked(true)}
            onEdit={() => setDrawingOverlay(true)}
            onChanged={refetch}
          />
        )}
      >
        <div className="flex h-full min-h-0 gap-4 p-4">
          <AnnotationToolbar
            tool={tool}
            onTool={setTool}
            color={color}
            onColor={setColor}
            canUndo={annotations.annotations.some(onLayer)}
            onUndo={undoAnnotation}
            top={
              <>
                <div>
                  <label htmlFor="marks" className="block text-xs font-medium uppercase tracking-wide text-slate-500">Mark</label>
                  <input
                    id="marks"
                    type="number"
                    min={0}
                    max={maxMarks}
                    step={1}
                    value={marks}
                    placeholder="0"
                    onChange={(e) => setTyped(auto !== null && e.target.value === String(auto) ? null : e.target.value)}
                    className={`mt-1 w-full rounded border px-2 py-1.5 text-center text-lg font-semibold focus:border-indigo-500 focus:outline-none ${flash ? 'border-indigo-500 ring-2 ring-indigo-200' : 'border-slate-300'}`}
                  />
                  {overriding && (
                    <p className="mt-1 text-[11px] leading-tight text-slate-500">
                      Typed mark in use.{' '}
                      <button type="button" onClick={() => setTyped(null)} className="font-medium text-indigo-600 underline">
                        {ticks > 0 ? `Use tick total (${ticks})` : 'Use 0 (crossed)'}
                      </button>
                    </p>
                  )}
                  {marks !== '' && !marksValid && (
                    <p role="alert" className="mt-1 text-xs text-red-600">Enter a whole number from 0 to {maxMarks}.</p>
                  )}
                </div>
                <Button
                  className="w-full"
                  disabled={!canSave || saveMutation.isPending || (!dirty && clip.state === 'marked')}
                  onClick={() => saveMutation.mutate(false, { onSuccess: refetch })}
                >
                  {blank ? 'Save as 0' : 'Save'}
                </Button>
                <Button variant="primary" className="w-full" disabled={!canSave || saveMutation.isPending} onClick={() => void saveAndNext()}>
                  {saveMutation.isPending ? 'Saving…' : blank ? 'Save as 0 & Next →' : 'Save & Next →'}
                </Button>
                <p className="min-h-4 text-center text-xs text-slate-500" aria-live="polite">{statusText}</p>
                {saveMutation.error && (
                  <p role="alert" className="text-xs text-red-600">{(saveMutation.error as Error).message}</p>
                )}
              </>
            }
          />

          {view === 'converted' && convertedUrl ? (
            <div className="flex min-h-0 min-w-0 flex-1 flex-col gap-2">
              <div className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-lg border border-sky-200 bg-sky-50 px-3 py-1.5 text-sm text-sky-900">
                <span className="font-medium">Converted handwriting</span>
                <span className="text-xs text-sky-700">Automatic, may contain mistakes. Ticks placed here count towards the same mark.</span>
                <button type="button" onClick={() => setView('script')} className="ml-auto text-xs font-medium underline">Back to script (Esc)</button>
                <button
                  type="button"
                  onClick={convertAgain}
                  disabled={convertMutation.isPending}
                  className="text-xs text-sky-700 underline disabled:opacity-60"
                >
                  {convertMutation.isPending ? 'Converting…' : 'Convert again'}
                </button>
              </div>
              <AnnotationCanvas
                key={convertedUrl}
                imageUrl={convertedUrl}
                annotations={annotations.annotations.filter((a) => a.layer === 'text')}
                tool={tool}
                color={color}
                zoom={convertedZoom.zoom}
                onZoom={convertedZoom.setZoom}
                onTool={setTool}
                onAdd={(a) => addAnnotation({ ...a, layer: 'text' })}
                onRemove={removeAnnotation}
                nextNumber={() => nextNumber(annotations.annotations)}
                markTickCount={ticks}
                maxMarkTicks={maxMarks}
              />
            </div>
          ) : (
            <AnnotationCanvas
              key={`${clip.id}-${clip.reclipped_at ?? ''}`}
              imageUrl={clip.clip_url}
              annotations={annotations.annotations.filter((a) => (a.layer ?? 'clip') === 'clip')}
              tool={tool}
              color={color}
              zoom={scriptZoom.zoom}
              onZoom={scriptZoom.setZoom}
              onTool={setTool}
              onAdd={addAnnotation}
              onRemove={removeAnnotation}
              nextNumber={() => nextNumber(annotations.annotations)}
              markTickCount={ticks}
              maxMarkTicks={maxMarks}
              overlay={overlayData && overlayView.show
                ? { data: overlayData, view: overlayView, movable: !overlayView.locked && canDragOverlay, onMove: (tx, ty) => { updateOverlayView({ tx, ty }); setOverlayPicked(true); }, onRotate: (deg) => updateOverlayView({ rotation: normaliseRotation(deg) }) }
                : undefined}
            />
          )}

          {showAi && clip.ai_mark && (
            <div className="min-h-0 w-72 flex-shrink-0 space-y-3 overflow-y-auto">
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
            </div>
          )}
        </div>
      </DockablePanel>
      </DockablePanel>
      {drawingOverlay && (
        <OverlayEditor
          examId={examId}
          questionId={question.id}
          questionLabel={questionLabel(question.question_number)}
          clips={list.length ? list : [{ id: clip.id }]}
          startClipId={clip.id}
          existing={overlayData}
          onClose={() => setDrawingOverlay(false)}
          onSaved={() => { setDrawingOverlay(false); setOverlayCreateOpen(false); setOverlayPanelHidden(false); updateOverlayView({ show: true }); refetch(); }}
        />
      )}
      {showPages && (
        <ScriptClipEditor
          scriptId={clip.script_id}
          questionId={question.id}
          questionNumber={questionLabel(question.question_number)}
          defaultRegions={question.clip_coordinates}
          defaultNameZones={question.name_zones}
          onClose={() => setShowPages(false)}
          onSaved={() => {
            // Ticks were placed on the old crop, so they no longer line up
            setShowPages(false);
            // (the server has discarded the converted page too: it was made from the old crop)
            setAnnotations({ annotations: [] });
            setConvertedUrl(null);
            setView('script');
            convertMutation.reset();
            refetch();
          }}
        />
      )}
    </div>
  );
}
