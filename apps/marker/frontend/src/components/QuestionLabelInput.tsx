import { useState } from 'react';
import { composeQuestionLabel, parseQuestionLabel, type QuestionParts } from '../lib/questionLabel';

interface Props {
  // The label to start from. Remount (change `key`) to load a different one.
  value: string;
  onChange: (label: string) => void;
  className?: string;
}

const box = 'rounded border border-slate-300 px-2 py-1 text-center focus:border-indigo-500 focus:outline-none';

// A question is a number, then an optional part and sub-part, typed in three boxes and written as 2(a)(i)
export function QuestionLabelInput({ value, onChange, className = '' }: Props) {
  const [parts, setParts] = useState<QuestionParts>(() => parseQuestionLabel(value) ?? { number: value, part: '', sub: '' });
  const label = composeQuestionLabel(parts);

  function update(next: Partial<QuestionParts>) {
    const merged = { ...parts, ...next };
    setParts(merged);
    onChange(composeQuestionLabel(merged));
  }

  return (
    <span className={`inline-flex flex-wrap items-center gap-1.5 text-sm text-slate-600 ${className}`}>
      <label className="flex items-center gap-1">
        Question
        <input
          type="text" inputMode="numeric" value={parts.number} maxLength={3} placeholder="2" aria-label="Question number"
          onChange={(e) => update({ number: e.target.value })} className={`${box} w-12`}
        />
      </label>
      <label className="flex items-center gap-1">
        Part
        <input
          type="text" value={parts.part} maxLength={1} placeholder="a" aria-label="Part, for example a"
          onChange={(e) => update({ part: e.target.value })} className={`${box} w-10`}
        />
      </label>
      <label className="flex items-center gap-1">
        Sub-part
        <input
          type="text" value={parts.sub} maxLength={5} placeholder="i" aria-label="Sub-part, for example i"
          onChange={(e) => update({ sub: e.target.value })} className={`${box} w-14`}
        />
      </label>
      <span className="text-xs text-slate-500" aria-live="polite">{label ? <>= <strong className="text-slate-700">Q{label}</strong></> : 'enter a number'}</span>
    </span>
  );
}
