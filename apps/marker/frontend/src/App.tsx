import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect } from 'react';
import { NavLink, Route, Routes, useLocation, useNavigate } from 'react-router-dom';
import { api, HttpError } from './api';
import { Login } from './pages/Login';
import { ExamList } from './pages/ExamList';
import { CreateExam } from './pages/CreateExam';
import { ExamSetup } from './pages/ExamSetup';
import { ExamProgress } from './pages/ExamProgress';
import { MyExams } from './pages/MyExams';
import { MarkingInterface } from './pages/MarkingInterface';
import { ComparativeMarking } from './pages/ComparativeMarking';

export function App() {
  const navigate = useNavigate();
  const location = useLocation();
  const qc = useQueryClient();

  const meQuery = useQuery({
    queryKey: ['auth', 'me'],
    queryFn: () => api.me(),
    retry: (failureCount, err) => {
      if (err instanceof HttpError && err.status === 401) return false;
      return failureCount < 2;
    },
  });

  useEffect(() => {
    const onUnauth = () => {
      if (location.pathname !== '/login') navigate('/login', { replace: true });
    };
    window.addEventListener('marker:unauthorized', onUnauth);
    return () => window.removeEventListener('marker:unauthorized', onUnauth);
  }, [navigate, location.pathname]);

  useEffect(() => {
    if (meQuery.error instanceof HttpError && meQuery.error.status === 401 && location.pathname !== '/login') {
      navigate('/login', { replace: true });
    }
  }, [meQuery.error, location.pathname, navigate]);

  const me = meQuery.data?.data;

  async function handleSignOut() {
    try { await api.logout(); } catch { /* ignore */ }
    qc.removeQueries({ queryKey: ['auth', 'me'] });
    navigate('/login', { replace: true });
  }

  if (location.pathname === '/login') {
    return <Routes><Route path="/login" element={<Login />} /></Routes>;
  }

  if (meQuery.isLoading) {
    return <div className="p-6 text-sm text-slate-500">Loading…</div>;
  }

  if (!me) return <div className="p-6 text-sm text-slate-500">Redirecting…</div>;

  const isTeacherOrAdmin = me.role === 'admin' || me.role === 'teacher';

  return (
    <div className="flex h-full flex-col">
      <header className="flex items-center gap-4 bg-indigo-700 px-4 py-2 text-white">
        <h1 className="text-lg font-semibold">UCS Marking</h1>
        <nav className="flex gap-3 text-sm">
          <NavLink to="/my-exams" className={navCls}>My Marking</NavLink>
          {isTeacherOrAdmin && <NavLink to="/exams" className={navCls}>Exams</NavLink>}
        </nav>
        <div className="ml-auto flex items-center gap-3 text-sm">
          <span className="opacity-90">{me.email}</span>
          <span className="rounded bg-indigo-600 px-2 py-0.5 text-xs">{me.role}</span>
          <button onClick={handleSignOut} className="rounded bg-indigo-800 px-2 py-1 text-xs hover:bg-indigo-900">
            Sign out
          </button>
        </div>
      </header>
      <main className="min-h-0 flex-1 overflow-auto">
        <Routes>
          <Route path="/" element={<MyExams />} />
          <Route path="/my-exams" element={<MyExams />} />
          <Route path="/exams" element={<ExamList />} />
          <Route path="/exams/new" element={<CreateExam />} />
          <Route path="/exams/:id/setup" element={<ExamSetup />} />
          <Route path="/exams/:id/progress" element={<ExamProgress />} />
          <Route path="/mark/:examId/:questionId" element={<MarkingInterface />} />
          <Route path="/compare/:examId/:questionId" element={<ComparativeMarking />} />
          <Route path="/login" element={<Login />} />
        </Routes>
      </main>
    </div>
  );
}

function navCls({ isActive }: { isActive: boolean }) {
  return isActive ? 'underline underline-offset-4' : 'opacity-80 hover:opacity-100';
}
