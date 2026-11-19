import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect } from 'react';
import { Navigate, Route, Routes, useLocation, useNavigate, useParams } from 'react-router-dom';
import { api, HttpError } from './api';
import { AppHeader } from './components/AppHeader';
import { navEntries } from './lib/navEntries';
import { useMarkingAccess } from './hooks/useMarkingAccess';
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
import { AiReport } from './pages/AiReport';
import { AiMarkingOverview, ComparativeOverview, MarkingLayout, MyMarking } from './pages/Marking';
import { MarkingInterface } from './pages/MarkingInterface';
import { ComparativeMarking } from './pages/ComparativeMarking';
import { ComparativeRanking } from './pages/ComparativeRanking';
import { StudentHome } from './pages/practice/StudentHome';
import { PracticeSets } from './pages/PracticeSets';
import { PracticeSetDetail } from './pages/PracticeSetDetail';
import { Join } from './pages/practice/Join';
import { PracticeMarking } from './pages/practice/PracticeMarking';
import { PracticeSummary } from './pages/practice/PracticeSummary';
import { PublicHome } from './pages/public/PublicHome';
import { Privacy } from './pages/public/Privacy';
import { Terms } from './pages/public/Terms';

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
  // Pages anyone may read without signing in: the privacy policy and terms, and the home page itself (shown to visitors who are not signed in)
  const onInfoPage = location.pathname === '/privacy' || location.pathname === '/terms';
  const onHome = location.pathname === '/';

  useEffect(() => {
    const onUnauth = () => {
      if (location.pathname !== '/login' && !onJoin && !onInfoPage && !onHome) navigate('/login', { replace: true });
    };
    window.addEventListener('marker:unauthorized', onUnauth);
    return () => window.removeEventListener('marker:unauthorized', onUnauth);
  }, [navigate, location.pathname, onJoin, onInfoPage, onHome]);

  useEffect(() => {
    if (meQuery.error instanceof HttpError && meQuery.error.status === 401 && location.pathname !== '/login' && !onJoin && !onInfoPage && !onHome) {
      navigate('/login', { replace: true });
    }
  }, [meQuery.error, location.pathname, navigate, onJoin, onInfoPage, onHome]);

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

  if (onInfoPage) {
    return <Routes><Route path="/privacy" element={<Privacy />} /><Route path="/terms" element={<Terms />} /></Routes>;
  }

  if (meQuery.isLoading) {
    return <div className="p-6 text-sm text-slate-500">Loading…</div>;
  }

  // Not signed in: the home page explains the service and offers sign-in; anywhere else goes to the sign-in page
  if (!me) return onHome ? <PublicHome /> : <div className="p-6 text-sm text-slate-500">Redirecting…</div>;

  // Students only ever see the practice pages (the server refuses them everything else too)
  if (me.role === 'student') {
    return (
      <div className="flex h-full flex-col">
        <AppHeader email={me.email} role="student" entries={navEntries('student', { leadsAny: false, hasComparative: false })} onSignOut={handleSignOut} />
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
      <StaffHeader email={me.email} role={me.role as 'admin' | 'teacher'} onSignOut={handleSignOut} />
      <main className="min-h-0 flex-1 overflow-auto">
        <Routes>
          <Route path="/" element={<Home />} />
          <Route path="/marking" element={<MarkingLayout />}>
            <Route index element={<MyMarking />} />
            <Route path="ai" element={<AiMarkingOverview />} />
            <Route path="comparative" element={<ComparativeOverview />} />
          </Route>
          <Route path="/marking/ai/report" element={<AiReport />} />
          <Route path="/marking/ai/:id" element={<RedirectTo to={(p, search) => `/marking/ai?exam=${p.id}${search.replace(/^\?/, '&')}`} />} />
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
        </Routes>
      </main>
    </div>
  );
}

// Send an old address to its new home, keeping the remembered "came from" page
function RedirectTo({ to }: { to: (params: Record<string, string | undefined>, search: string) => string }) {
  const params = useParams();
  const loc = useLocation();
  return <Navigate to={to(params, loc.search)} replace state={loc.state} />;
}

// The staff bar needs to know whether this person leads any exam (for AI marking) and whether comparative marking applies to them
function StaffHeader({ email, role, onSignOut }: { email: string; role: 'admin' | 'teacher'; onSignOut: () => void }) {
  const access = useMarkingAccess();
  return <AppHeader email={email} role={role} entries={navEntries(role, access)} onSignOut={onSignOut} />;
}
