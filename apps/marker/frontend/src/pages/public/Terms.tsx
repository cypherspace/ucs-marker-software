import { SITE } from '../../lib/siteInfo';
import { ContactEmail, DraftNotice, Fill, PublicLayout } from './PublicLayout';

export function Terms() {
  return (
    <PublicLayout title="Terms of use">
      <h1 className="text-3xl font-bold text-slate-900">Terms of use</h1>
      <p className="mt-1 text-sm text-slate-500">Last updated {SITE.lastUpdated}</p>

      <div className="mt-6">
        <DraftNotice items={[
          'Who is named as the operator and the contact address (lib/siteInfo.ts).',
          'Whether the school wants its own acceptable-use wording added, and the governing law and liability wording (a solicitor or the school should confirm).',
          'Any service-level or support commitments, if the service is offered to other schools.',
        ]}
        />
      </div>

      <div className="space-y-6 text-slate-700">
        <section>
          <h2 className="text-xl font-semibold text-slate-900">1. The service</h2>
          <p className="mt-2">
            {SITE.appName} is an online system for marking scanned exam scripts and for student practice marking. It is run by <Fill value={SITE.operatorName} label="operator name" /> for
            {' '}{SITE.schoolName}. By signing in you agree to these terms and to the <a href="/privacy" className="text-indigo-700 underline">privacy policy</a>.
          </p>
        </section>
        <section>
          <h2 className="text-xl font-semibold text-slate-900">2. Who may use it</h2>
          <ul className="mt-2 list-disc space-y-1 pl-5">
            <li>Staff accounts are created by an administrator. Sign in only with your own school account and do not share it.</li>
            <li>Students may use only the practice area, with their own school account.</li>
            <li>Access can be removed at any time, for example when someone leaves the school.</li>
          </ul>
        </section>
        <section>
          <h2 className="text-xl font-semibold text-slate-900">3. Acceptable use</h2>
          <ul className="mt-2 list-disc space-y-1 pl-5">
            <li>Use the service only for the school&apos;s teaching, assessment and practice purposes.</li>
            <li>Do not try to see data you are not meant to see, share practice links outside the intended class, or interfere with the service.</li>
            <li>Teachers are responsible for uploading scripts only where the school is entitled to use them, and for sharing practice sets only with the intended class.</li>
          </ul>
        </section>
        <section>
          <h2 className="text-xl font-semibold text-slate-900">4. AI suggestions</h2>
          <p className="mt-2">
            AI suggestions are only a help. They can be wrong. A mark counts only when a teacher has set it, and teachers remain responsible for the marks they give.
          </p>
        </section>
        <section>
          <h2 className="text-xl font-semibold text-slate-900">5. Your data</h2>
          <p className="mt-2">
            The school is responsible for the pupil data it puts into the service. How personal data is handled is described in the <a href="/privacy" className="text-indigo-700 underline">privacy policy</a>.
          </p>
        </section>
        <section>
          <h2 className="text-xl font-semibold text-slate-900">6. Availability and changes</h2>
          <p className="mt-2">
            We aim to keep the service available but cannot promise it will always be, and we may change or withdraw features. We will try to give notice of changes that affect how you use it.
          </p>
        </section>
        <section>
          <h2 className="text-xl font-semibold text-slate-900">7. Liability and law</h2>
          <p className="mt-2"><Fill value="" label="liability and governing-law wording to be confirmed" /></p>
        </section>
        <section>
          <h2 className="text-xl font-semibold text-slate-900">8. Contact</h2>
          <p className="mt-2">Questions about these terms: <ContactEmail />.</p>
        </section>
      </div>
    </PublicLayout>
  );
}
