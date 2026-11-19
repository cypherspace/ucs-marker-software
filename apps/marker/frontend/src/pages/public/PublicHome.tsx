import { Link } from 'react-router-dom';
import { SignInButtons, SignInHelp } from '../../components/SignInButtons';
import { SITE } from '../../lib/siteInfo';
import { ContactEmail, PublicLayout } from './PublicLayout';

// What anyone sees at the address before signing in: what the service is, who it is for, and how personal data is handled.
export function PublicHome() {
  return (
    <PublicLayout>
      <div className="grid gap-8 md:grid-cols-[1fr_18rem]">
        <section>
          <h1 className="text-3xl font-bold text-slate-900">{SITE.appName}</h1>
          <p className="mt-3 text-lg text-slate-700">
            Online marking of scanned exam scripts for schools, with optional AI assistance, and practice marking for students.
          </p>

          <h2 className="mt-8 text-lg font-semibold text-slate-900">What it does</h2>
          <ul className="mt-2 list-disc space-y-2 pl-5 text-slate-700">
            <li>Teachers upload scanned scripts, set up the questions and mark each answer on screen with ticks, marks and notes.</li>
            <li>The system cuts out each answer so a teacher can mark one question across a whole class, and keeps the marks, progress and results together.</li>
            <li>An AI model can suggest marks for a teacher to accept or ignore. Only the teacher&apos;s mark counts.</li>
            <li>Students can practise marking sample answers a teacher has chosen to share, then compare their marking with their teachers&apos;.</li>
          </ul>

          <h2 className="mt-8 text-lg font-semibold text-slate-900">Who it is for</h2>
          <p className="mt-2 text-slate-700">
            Teachers and students at schools that use it, signed in with their school Google account. {SITE.schoolName} staff are invited by an
            administrator; students reach their practice area through a link from their teacher.
          </p>

          <h2 className="mt-8 text-lg font-semibold text-slate-900">Your data</h2>
          <p className="mt-2 text-slate-700">
            Students are only asked for their name, school email address and profile picture when they sign in, and never for access to
            their Drive or anything else. Exam scripts are kept in the lead teacher&apos;s Google Drive. Student data is not sold or used for advertising.
            Read the <Link to="/privacy" className="text-indigo-700 underline">privacy policy</Link> and the{' '}
            <Link to="/terms" className="text-indigo-700 underline">terms of use</Link>. Questions: <ContactEmail />.
          </p>
        </section>

        <aside className="h-fit rounded-xl border bg-white p-6 shadow-sm">
          <h2 className="mb-4 text-center text-lg font-semibold text-slate-800">Sign in</h2>
          <SignInButtons />
          <SignInHelp />
        </aside>
      </div>
    </PublicLayout>
  );
}
