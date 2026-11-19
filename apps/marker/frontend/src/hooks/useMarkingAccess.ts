import { useQuery } from '@tanstack/react-query';
import { api } from '../api';

/** Which marking areas apply to this person: AI marking needs leading an exam (or being an admin); comparative needs comparative questions. */
export function useMarkingAccess(): { leadsAny: boolean; hasComparative: boolean } {
  const meQ = useQuery({ queryKey: ['auth', 'me'], queryFn: () => api.me() });
  const examsQ = useQuery({ queryKey: ['exams'], queryFn: () => api.listExams() });
  const homeQ = useQuery({ queryKey: ['home'], queryFn: () => api.home() });
  const me = meQ.data?.data;
  const leadsAny = (examsQ.data?.data ?? []).some((e) => me && (me.role === 'admin' || e.lead_teacher_id === me.id));
  return { leadsAny, hasComparative: (homeQ.data?.data.comparative.questions ?? 0) > 0 };
}
