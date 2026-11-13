import { useEffect, useRef } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { useNavigate, useParams } from 'react-router-dom';
import { api, HttpError } from '../../api';

// The page a class link opens (/join/<token>). Not signed in: a student sign-in button that asks for no Drive access
// and brings the student straight back here. Signed in as a student: joins the set. Signed in as staff: told this is for students.
export function Join() {
  const { token } = useParams<{ token: string }>();
  const navigate = useNavigate();
  const meQ = useQuery({
    queryKey: ['auth', 'me'], queryFn: () => api.me(),
    retry: (n, err) => !(err instanceof HttpError && err.status === 401) && n < 2,
  });
  const me = meQ.data?.data;
  const join = useMutation({
    mutationFn: () => api.joinPractice(token!),
    onSuccess: (r) => navigate(`/practice/${r.data.set_id}`, { replace: true }),
  });
  const started = useRef(false);
  useEffect(() => {
    if (me?.role === 'student' && token && !started.current) { started.current = true; join.mutate(); }
  }, [me, token, join]);

  const shell = (children: React.ReactNode) => (
    <div className="flex h-full items-center justify-center bg-slate-50 p-4">
      <div className="w-full max-w-sm rounded-xl border bg-white p-8 text-center shadow-sm">
        <div className="mb-2 text-3xl font-bold text-indigo-700">UCS</div>
        <h1 className="mb-4 text-xl font-semibold text-slate-800">Practice marking</h1>
        {children}
      </div>
    </div>
  );

  if (meQ.isLoading) return shell(<p className="text-sm text-slate-500">Loading…</p>);

  if (!me) {
    const next = encodeURIComponent(`/join/${token}`);
    return shell(
      <>
        <p className="mb-4 text-sm text-slate-600">Your teacher has shared some work for you to mark. Sign in with your school Google account to start.</p>
        <a
          href={`/auth/google/student?next=${next}`}
          className="flex w-full items-center justify-center rounded-lg border border-slate-300 bg-white px-4 py-2.5 text-sm font-medium text-slate-700 shadow-sm hover:bg-slate-50"
        >
          Sign in with Google
        </a>
        <p className="mt-3 text-xs text-slate-400">Only your name and school email are used. No access to your Drive is asked for.</p>
      </>,
    );
  }

  if (me.role !== 'student') {
    return shell(
      <>
        <p className="mb-4 text-sm text-slate-600">This link is for students. You are signed in as staff ({me.email}).</p>
        <a href="/" className="text-sm font-medium text-indigo-600 underline">Go to the marking system</a>
      </>,
    );
  }

  if (join.isError) {
    return shell(<p role="alert" className="text-sm text-red-700">{(join.error as Error).message}</p>);
  }
  return shell(<p className="text-sm text-slate-500">Joining…</p>);
}
