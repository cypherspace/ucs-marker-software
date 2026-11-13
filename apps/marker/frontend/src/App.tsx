import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect } from 'react';
import { Link, Navigate, NavLink, Route, Routes, useLocation, useNavigate, useParams } from 'react-router-dom';
import { api, HttpError } from './api';
import { Login } from './pages/Login';
import { Home } from './pages/Home';
import { Admin } from './pages/Admin';
import { ExamList } from './pages/ExamList';
import { CreateExam } from './pages/CreateExam';
import { ExamSetup } from './pages/ExamSetup';
import { ExamProgress } from './pages/ExamProgress';
import { MarkingAgreement } from './pages/MarkingAgreement';
import { ExamPage } from './pages/ExamPage';
import { ExamResults } from './pages/ExamResults';
import { ExamUpload } from './pages/ExamUpload';
import { AiMarkingOverview, ComparativeOverview, MarkingLayout, MyMarking } from './pages/Marking';
import { MarkingInterface } from './pages/MarkingInterface';
import { ComparativeMarking } from './pages/ComparativeMarking';
import { ComparativeRanking } from './pages/ComparativeRanking';
import { AiMarking } from './pages/AiMarking';
import { StudentHome } from './pages/practice/StudentHome';
import { PracticeSets } from './pages/PracticeSets';
import { PracticeSetDetail } from './pages/PracticeSetDetail';
import { Join } from './pages/practice/Join';
import { PracticeMarking } from './pages/practice/PracticeMarking';
import { PracticeSummary } from './pages/practice/PracticeSummary';

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

  const onJoin = location.pathname.startsWith('/join/');

  useEffect(() => {
    const onUnauth = () => {
      if (location.pathname !== '/login' && !onJoin) navigate('/login', { replace: true });
    };
    window.addEventListener('marker:unauthorized', onUnauth);
    return () => window.removeEventListener('marker:unauthorized', onUnauth);
  }, [navigate, location.pathname, onJoin]);

  useEffect(() => {
    if (meQuery.error instanceof HttpError && meQuery.error.status === 401 && location.pathname !== '/login' && !onJoin) {
      navigate('/login', { replace: true });
    }
  }, [meQuery.error, location.pathname, navigate, onJoin]);

  const me = meQuery.data?.data;

  async function handleSignOut() {
    try { await api.logout(); } catch { /* ignore */ }
    qc.removeQueries({ queryKey: ['auth', 'me'] });
    navigate('/login', { replace: true });
  }

  // A class link: handles its own sign-in (a student sign-in that comes back here)
  if (onJoin) {
    return <Routes><Route path="/join/:token" element={<Join />} /></Routes>;
  }

  if (location.pathname === '/login') {
    return <Routes><Route path="/login" element={<Login />} /></Routes>;
  }

  if (meQuery.isLoading) {
    return <div className="p-6 text-sm text-slate-500">Loading…</div>;
  }

  if (!me) return <div className="p-6 text-sm text-slate-500">Redirecting…</div>;

  const isTeacherOrAdmin = me.role === 'admin' || me.role === 'teacher';

  // Students only ever see the practice pages (the server refuses them everything else too)
  if (me.role === 'student') {
    return (
      <div className="flex h-full flex-col">
        <header className="flex flex-wrap items-center gap-x-4 gap-y-1 bg-indigo-700 px-4 py-2 text-white">
          <h1 className="whitespace-nowrap text-lg font-semibold"><Link to="/practice" className="hover:opacity-90">UCS Marking</Link></h1>
          <nav className="flex flex-wrap gap-x-3 text-sm whitespace-nowrap">
            <NavLink to="/practice" end className={navCls}>Practice marking</NavLink>
          </nav>
          <div className="ml-auto flex items-center gap-3 whitespace-nowrap text-sm">
            <span className="hidden opacity-90 sm:inline">{me.email}</span>
            <button onClick={handleSignOut} className="rounded bg-indigo-800 px-2 py-1 text-xs hover:bg-indigo-900">Sign out</button>
          </div>
        </header>
        <main className="min-h-0 flex-1 overflow-auto">
          <Routes>
            <Route path="/practice" element={<StudentHome />} />
            <Route path="/practice/:setId" element={<PracticeMarking />} />
            <Route path="/practice/:setId/summary" element={<PracticeSummary />} />
            <Route path="/practice/:setId/:itemId" element={<PracticeMarking />} />
            <Route path="*" element={<Navigate to="/practice" replace />} />
          </Routes>
        </main>
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col">
      <header className="flex flex-wrap items-center gap-x-4 gap-y-1 bg-indigo-700 px-4 py-2 text-white">
        <h1 className="whitespace-nowrap text-lg font-semibold"><Link to="/" className="hover:opacity-90">UCS Marking</Link></h1>
        <nav className="flex flex-wrap gap-x-3 text-sm whitespace-nowrap">
          <NavLink to="/" end className={navCls}>Home</NavLink>
          <NavLink to="/marking" className={navCls}>Marking</NavLink>
          {isTeacherOrAdmin && <NavLink to="/exams" className={navCls}>Exams</NavLink>}
          {me.role === 'admin' && <NavLink to="/admin" className={navCls}>Admin</NavLink>}
        </nav>
        <div className="ml-auto flex items-center gap-3 whitespace-nowrap text-sm">
          <span className="hidden opacity-90 sm:inline">{me.email}</span>
          <span className="rounded bg-indigo-600 px-2 py-0.5 text-xs">{me.role}</span>
          <button onClick={handleSignOut} className="rounded bg-indigo-800 px-2 py-1 text-xs hover:bg-indigo-900">
            Sign out
          </button>
        </div>
      </header>
      <main className="min-h-0 flex-1 overflow-auto">
        <Routes>
          <Route path="/" element={<Home />} />
          <Route path="/marking" element={<MarkingLayout />}>
            <Route index element={<MyMarking />} />
            <Route path="ai" element={<AiMarkingOverview />} />
            <Route path="comparative" element={<ComparativeOverview />} />
          </Route>
          <Route path="/marking/ai/:id" element={<AiMarking />} />
          <Route path="/exams" element={<ExamList />} />
          <Route path="/exams/new" element={<CreateExam />} />
          <Route path="/practice-sets/:setId" element={<PracticeSetDetail />} />
          <Route path="/exams/:id/agreement/:questionId" element={<MarkingAgreement />} />
          <Route path="/exams/:id" element={<ExamPage />}>
            <Route index element={<ExamProgress />} />
            <Route path="results" element={<ExamResults />} />
            <Route path="setup" element={<ExamSetup />} />
            <Route path="upload" element={<ExamUpload />} />
            <Route path="practice" element={<PracticeSets />} />
          </Route>
          {/* Addresses used before the exam page and Marking area existed */}
          <Route path="/my-exams" element={<Navigate to="/marking" replace />} />
          <Route path="/exams/:id/progress" element={<RedirectTo to={(p) => `/exams/${p.id}`} />} />
          <Route path="/exams/:id/ai" element={<RedirectTo to={(p) => `/marking/ai/${p.id}`} />} />
          <Route path="/mark/:examId/:questionId" element={<MarkingInterface />} />
          <Route path="/mark/:examId/:questionId/:clipId" element={<MarkingInterface />} />
          <Route path="/compare/:examId/:questionId" element={<ComparativeMarking />} />
          <Route path="/compare/:examId/:questionId/ranking" element={<ComparativeRanking />} />
          <Route path="/admin" element={<Admin />} />
          <Route path="/login" element={<Login />} />
        </Routes>
      </main>
    </div>
  );
}

// Send an old address to its new home, keeping the remembered "came from" page
function RedirectTo({ to }: { to: (params: Record<string, string | undefined>) => string }) {
  const params = useParams();
  const loc = useLocation();
  return <Navigate to={to(params)} replace state={loc.state} />;
}

function navCls({ isActive }: { isActive: boolean }) {
  return isActive ? 'underline underline-offset-4' : 'opacity-80 hover:opacity-100';
}
