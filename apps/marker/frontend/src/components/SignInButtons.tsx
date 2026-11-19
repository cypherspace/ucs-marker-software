export function GoogleIcon() {
  return (
    <svg className="h-4 w-4" viewBox="0 0 24 24" aria-hidden>
      <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"/>
      <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/>
      <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"/>
      <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"/>
    </svg>
  );
}

// The two ways in: staff, and students (who are only ever asked for their name, email and profile picture)
export function SignInButtons() {
  return (
    <div>
      <a
        href="/auth/google"
        className="flex w-full items-center justify-center gap-3 rounded-lg border border-slate-300 bg-white px-4 py-2.5 text-sm font-medium text-slate-700 shadow-sm transition-colors hover:bg-slate-50"
      >
        <GoogleIcon />
        Staff sign-in with Google
      </a>
      <div className="mt-4 border-t border-slate-100 pt-4">
        <a
          href="/auth/google/student"
          className="flex w-full items-center justify-center rounded-lg border border-slate-200 px-4 py-2 text-sm font-medium text-slate-600 hover:bg-slate-50"
        >
          Student sign-in
        </a>
        <p className="mt-2 text-center text-xs text-slate-500">
          Students: use the link your teacher gave you, or use Student sign-in with your school account.
        </p>
      </div>
    </div>
  );
}

// Google shows its own error page for some blocks (the app never gets to see them), so say here what they mean
export function SignInHelp() {
  return (
    <details className="mt-4 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-600">
      <summary className="cursor-pointer font-medium text-slate-700">Having trouble signing in?</summary>
      <div className="mt-2 space-y-2">
        <p>
          If Google says <em>&ldquo;Access blocked: Your institution&apos;s admin needs to review&hellip;&rdquo;</em> (error
          <code className="mx-1 rounded bg-white px-1">access_not_configured</code>), your school&apos;s Google settings do not yet allow this app for
          your account. Tell your teacher or the school&apos;s IT team; nothing is wrong with your account.
        </p>
        <p>
          If it says the account is not allowed, check you used your school Google account. Staff accounts have to be invited by an
          administrator first.
        </p>
      </div>
    </details>
  );
}
