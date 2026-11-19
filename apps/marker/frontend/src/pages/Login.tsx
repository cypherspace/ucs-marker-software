import { Link, useSearchParams } from 'react-router-dom';
import { SignInButtons, SignInHelp } from '../components/SignInButtons';

const ERROR_MESSAGES: Record<string, string> = {
  not_allowed: 'This account is not allowed in. Use your school Google account, or ask your teacher.',
  deactivated: 'This account has been deactivated. Contact your system administrator.',
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
          <p className="mt-1 text-sm text-slate-500">Sign in with your school Google account</p>
        </div>

        {error && (
          <div className="mb-4 rounded-lg bg-red-50 border border-red-200 px-4 py-3 text-sm text-red-700">
            {ERROR_MESSAGES[error] ?? `Sign-in error: ${error}`}
          </div>
        )}

        <SignInButtons />
        <SignInHelp />
        <p className="mt-4 text-center text-xs text-slate-500">
          <Link to="/" className="hover:underline">About this service</Link> · <Link to="/privacy" className="hover:underline">Privacy</Link> · <Link to="/terms" className="hover:underline">Terms</Link>
        </p>
      </div>
    </div>
  );
}
