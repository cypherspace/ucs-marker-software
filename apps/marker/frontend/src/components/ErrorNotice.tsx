import { useEffect, useState } from 'react';
import { friendlyError } from '../lib/errors';

// An error from a single action (not a long run), in plain words. When the server said how long to wait
// (a Gemini rate limit) the Try again button counts down instead of letting people hammer it.
export function ErrorNotice({ error, onRetry, className = '' }: { error: unknown; onRetry?: () => void; className?: string }) {
  const f = friendlyError(error);
  const [left, setLeft] = useState(f.retryAfter ?? 0);

  useEffect(() => {
    setLeft(f.retryAfter ?? 0);
    if (!f.retryAfter) return;
    const t = setInterval(() => setLeft((n) => Math.max(0, n - 1)), 1000);
    return () => clearInterval(t);
  }, [error, f.retryAfter]);

  return (
    <div role="alert" className={`border-b border-red-200 bg-red-50 px-4 py-2 text-sm text-red-700 ${className}`}>
      {f.message}
      {onRetry && f.retryable && (
        <button
          onClick={onRetry}
          disabled={left > 0}
          className="ml-3 font-medium underline disabled:cursor-not-allowed disabled:no-underline disabled:opacity-60"
        >
          {left > 0 ? `Try again in ${left}s` : 'Try again'}
        </button>
      )}
    </div>
  );
}
