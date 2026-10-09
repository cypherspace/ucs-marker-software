import type { ButtonHTMLAttributes, ReactNode } from 'react';
import { Link, type LinkProps } from 'react-router-dom';
import { useFromState } from '../lib/nav';

// ── Buttons ─────────────────────────────────────────────────────────────────
// primary: the one thing you most likely want to do. secondary: a clearly
// bordered alternative. danger: destructive, outlined so it never competes.
export type ButtonVariant = 'primary' | 'secondary' | 'danger';

const BASE =
  'inline-flex items-center justify-center gap-2 rounded-lg px-4 text-sm font-medium whitespace-nowrap select-none ' +
  'min-h-11 sm:min-h-9 transition-colors cursor-pointer ' +
  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 focus-visible:ring-offset-2 ' +
  'disabled:cursor-not-allowed disabled:opacity-50 aria-disabled:cursor-not-allowed aria-disabled:opacity-50';

const VARIANTS: Record<ButtonVariant, string> = {
  primary: 'bg-indigo-600 text-white shadow-sm hover:bg-indigo-700 active:bg-indigo-800',
  secondary: 'border border-slate-300 bg-white text-slate-700 shadow-sm hover:bg-slate-50 active:bg-slate-100',
  danger: 'border border-red-200 bg-white text-red-600 hover:bg-red-50 active:bg-red-100',
};

export function buttonClass(variant: ButtonVariant = 'secondary', extra = ''): string {
  return `${BASE} ${VARIANTS[variant]} ${extra}`.trim();
}

export function Button({
  variant = 'secondary', className = '', type = 'button', ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: ButtonVariant }) {
  return <button type={type} className={buttonClass(variant, className)} {...props} />;
}

// Links remember the page they were clicked on so the next page's Back button can return here.
export function LinkButton({
  variant = 'secondary', className = '', state, ...props
}: LinkProps & { variant?: ButtonVariant }) {
  const from = useFromState();
  return <Link className={buttonClass(variant, className)} state={state ?? from} {...props} />;
}

/** A text link that, like LinkButton, remembers the page it was clicked on. */
export function AppLink({ state, ...props }: LinkProps) {
  const from = useFromState();
  return <Link state={state ?? from} {...props} />;
}

// ── Exam status ─────────────────────────────────────────────────────────────
// Deliberately flat (a dot and text, no fill or border) so it reads as a label
// and cannot be mistaken for a button.
const STATUS_LABELS: Record<string, string> = {
  setup: 'Setup',
  clipping: 'Processing',
  marking: 'Marking',
  complete: 'Complete',
};

const STATUS_DOTS: Record<string, string> = {
  setup: 'bg-slate-400',
  clipping: 'bg-amber-500',
  marking: 'bg-blue-500',
  complete: 'bg-green-500',
};

export function statusLabel(status: string): string {
  return STATUS_LABELS[status] ?? status;
}

export function StatusPill({ status }: { status: string }) {
  return (
    <span className="inline-flex items-center gap-1.5 text-xs font-medium text-slate-600">
      <span className={`h-2 w-2 rounded-full ${STATUS_DOTS[status] ?? 'bg-slate-400'}`} aria-hidden />
      {statusLabel(status)}
    </span>
  );
}

// ── Progress ────────────────────────────────────────────────────────────────
export function ProgressBar({ value, max, label }: { value: number; max: number; label?: string }) {
  const pct = max > 0 ? Math.min(100, Math.round((value / max) * 100)) : 0;
  return (
    <div
      role="progressbar"
      aria-valuenow={pct}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-label={label ?? 'Progress'}
      className="h-2 w-full overflow-hidden rounded-full bg-slate-200"
    >
      <div className="h-2 rounded-full bg-indigo-500 transition-all" style={{ width: `${pct}%` }} />
    </div>
  );
}

// ── Card ────────────────────────────────────────────────────────────────────
export function Card({ children, className = '' }: { children: ReactNode; className?: string }) {
  return (
    <div className={`rounded-xl border border-slate-200 bg-white shadow-sm ${className}`}>{children}</div>
  );
}
