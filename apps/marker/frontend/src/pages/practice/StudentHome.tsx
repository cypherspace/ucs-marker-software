import { Card } from '../../components/ui';

// A student's page. The sets of work a teacher has shared with their class appear here.
export function StudentHome() {
  return (
    <div className="mx-auto max-w-3xl p-4 sm:p-6">
      <h1 className="mb-1 text-2xl font-semibold text-slate-800">Practice marking</h1>
      <p className="mb-6 text-sm text-slate-500">Mark real answers, then see how your marks compare with your teachers'.</p>
      <Card className="p-6 text-center text-slate-600">
        You have no sets of work yet. When your teacher shares a link with your class, open it and the set will appear here.
      </Card>
    </div>
  );
}
