import { useCallback, useEffect, useState } from 'react';
import { loadView, saveView, type OverlayView } from '../lib/overlay';

/**
 * Where a question's overlay is, and how it looks, remembered in this browser per question. Moving to the next script
 * keeps it where it was put (it only changes when the teacher changes it); another question has its own.
 */
export function useOverlayView(questionId: string) {
  const [state, setState] = useState(() => ({ questionId, view: loadView(questionId) }));

  // A different question: load that question's own view (done while rendering, so there is no frame with the wrong one)
  if (state.questionId !== questionId) setState({ questionId, view: loadView(questionId) });

  useEffect(() => { saveView(state.questionId, state.view); }, [state]);

  const update = useCallback((change: Partial<OverlayView> | ((v: OverlayView) => OverlayView)) => {
    setState((s) => ({ ...s, view: typeof change === 'function' ? change(s.view) : { ...s.view, ...change } }));
  }, []);

  return [state.view, update] as const;
}
