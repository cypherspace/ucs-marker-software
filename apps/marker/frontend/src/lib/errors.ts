import { HttpError } from '../api';

export interface FriendlyError {
  message: string;
  code?: string;
  // Seconds to wait before trying again, when the server said so
  retryAfter?: number;
  retryable: boolean;
}

// One place that turns anything thrown by an API call into words a teacher can act on.
// Messages from our own server are already plain; the rest (a dropped connection, a timeout from
// Cloud Run's front door that carries no JSON) are explained here.
export function friendlyError(err: unknown): FriendlyError {
  if (err instanceof HttpError) {
    const body = err.body ?? {};
    const retryAfter = typeof body.retry_after_seconds === 'number' ? body.retry_after_seconds : undefined;
    const bodyRetryable = typeof body.retryable === 'boolean' ? body.retryable : undefined;
    if (err.code) {
      return { message: err.message, code: err.code, retryAfter, retryable: bodyRetryable ?? false };
    }
    if (err.status === 502 || err.status === 503 || err.status === 504) {
      return {
        message: 'The server took too long or was restarting. Wait a few seconds and try again.',
        retryAfter, retryable: true,
      };
    }
    if (err.status === 429) {
      return { message: 'Too many requests at once. Wait a moment and try again.', retryAfter, retryable: true };
    }
    if (err.status >= 500) {
      return { message: 'Something went wrong on the server. Try again; if it keeps happening, tell an administrator.', retryable: true };
    }
    return { message: err.message, retryAfter, retryable: bodyRetryable ?? false };
  }
  if (err instanceof TypeError) {
    return { message: 'Could not reach the server. Check your connection and try again.', retryable: true };
  }
  return { message: err instanceof Error ? err.message : 'Something went wrong.', retryable: false };
}
