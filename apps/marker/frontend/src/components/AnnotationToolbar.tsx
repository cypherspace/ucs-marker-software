import type { ReactNode } from 'react';
import type { AnnotationTool } from '@marker/shared-types';

export type Tool = AnnotationTool | 'erase';

export const TOOL_LABELS: Record<Tool, string> = {
  mark_tick: '+1 Mark tick',
  tick: '✓ Tick',
  cross: '✗ Cross',
  numbered_tick: '#✓ Numbered Tick',
  numbered_cross: '#✗ Numbered Cross',
  circle: '○ Circle',
  underline: '― Underline',
  ruler: '╱ Ruler',
  text: 'T Text',
  erase: '⌫ Erase',
};

export const TOOLS = Object.keys(TOOL_LABELS) as Tool[];

export const COLORS = ['#16a34a', '#dc2626', '#2563eb', '#d97706', '#7c3aed', '#000000'];

// Mark ticks always look the same, so they cannot be confused with an ordinary tick
export const MARK_COLOR = '#4f46e5';

/**
 * The marking tools: an optional block at the top (the marks box and save buttons), then the
 * tools, colours and undo. It sits outside the scrolling script so it is always in view, and is
 * shared by the script and the converted-handwriting view so both behave identically.
 */
export function AnnotationToolbar({
  tool, onTool, color, onColor, canUndo, onUndo, top,
}: {
  tool: Tool;
  onTool: (t: Tool) => void;
  color: string;
  onColor: (c: string) => void;
  canUndo: boolean;
  onUndo: () => void;
  top?: ReactNode;
}) {
  return (
    <div className="flex w-44 flex-shrink-0 flex-col gap-1 overflow-y-auto pr-1">
      {top && <div className="mb-2 space-y-2 border-b border-slate-200 pb-3">{top}</div>}

      <div className="text-xs font-medium uppercase tracking-wide text-slate-500">Tool</div>
      {TOOLS.map((t) => (
        <button
          key={t}
          type="button"
          onClick={() => onTool(t)}
          aria-pressed={tool === t}
          className={`rounded px-2 py-1 text-left text-xs font-medium transition-colors ${
            tool === t
              ? 'bg-indigo-600 text-white'
              : t === 'mark_tick'
                ? 'bg-indigo-50 text-indigo-700 ring-1 ring-indigo-200 hover:bg-indigo-100'
                : 'bg-slate-100 text-slate-700 hover:bg-slate-200'
          }`}
        >
          {TOOL_LABELS[t]}
        </button>
      ))}

      <div className="mt-2 text-xs font-medium uppercase tracking-wide text-slate-500">Colour</div>
      <div className="flex flex-wrap gap-1.5">
        {COLORS.map((c) => (
          <button
            key={c}
            type="button"
            onClick={() => onColor(c)}
            aria-label={`Colour ${c}`}
            style={{ background: c }}
            className={`h-6 w-6 rounded-full border-2 transition-all ${color === c ? 'scale-110 border-slate-700' : 'border-transparent'}`}
          />
        ))}
      </div>

      <div className="mt-2 border-t border-slate-200 pt-2">
        <button
          type="button"
          onClick={onUndo}
          disabled={!canUndo}
          className="w-full rounded bg-slate-100 px-2 py-1 text-xs text-slate-600 hover:bg-red-50 hover:text-red-600 disabled:opacity-40"
        >
          Undo last
        </button>
      </div>

      <p className="mt-1 text-[11px] leading-tight text-slate-400">
        <strong>Double-click</strong> to place or remove a tick, cross or mark. Right-click to change tool.
      </p>
    </div>
  );
}
