import { useSearchParams } from 'react-router-dom';

const ERROR_MESSAGES: Record<string, string> = {
  not_allowed: 'Your account is not authorised. Contact your system administrator.',
  google_error: 'Google sign-in failed. Please try again.',
  oauth_failed: 'Authentication failed. Please try again.',
  stale_state: 'Login session expired. Please try again.',
  unverified_email: 'Your Google email is not verified.',
};

export function Login() {
  const [params] = useSearchParams();
  const error = params.get('error');

  return (
    <div className="flex h-full items-center justify-center bg-slate-50">
      <div className="w-full max-w-sm rounded-xl border bg-white p-8 shadow-sm">
        <div className="mb-6 text-center">
          <div className="mb-2 text-3xl font-bold text-indigo-700">UCS</div>
          <h1 className="text-xl font-semibold text-slate-800">Marking System</h1>
          <p className="mt-1 text-sm text-slate-500">Sign in with your UCS Google account</p>
        </div>

        {error && (
          <div className="mb-4 rounded-lg bg-red-50 border border-red-200 px-4 py-3 text-sm text-red-700">
            {ERROR_MESSAGES[error] ?? `Sign-in error: ${error}`}
          </div>
        )}

        <a
          href="/auth/google"
          className="flex w-full items-center justify-center gap-3 rounded-lg border border-slate-300 bg-white px-4 py-2.5 text-sm font-medium text-slate-700 shadow-sm hover:bg-slate-50 transition-colors"
        >
          <GoogleIcon />
          Sign in with Google
        </a>

        <p className="mt-6 text-center text-xs text-slate-400">
          Access restricted to authorised UCS staff.
        </p>
      </div>
    </div>
  );
}

function GoogleIcon() {
  return (
    <svg className="h-4 w-4" viewBox="0 0 24 24">
      <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"/>
      <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/>
      <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"/>
      <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"/>
    </svg>
  );
}
