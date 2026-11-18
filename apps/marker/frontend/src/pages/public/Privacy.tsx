import type { ReactNode } from 'react';
import { SITE } from '../../lib/siteInfo';
import { ContactEmail, DraftNotice, Fill, PublicLayout } from './PublicLayout';

function H({ children }: { children: ReactNode }) {
  return <h2 className="text-xl font-semibold text-slate-900">{children}</h2>;
}

export function Privacy() {
  return (
    <PublicLayout title="Privacy policy">
      <h1 className="text-3xl font-bold text-slate-900">Privacy policy</h1>
      <p className="mt-1 text-sm text-slate-500">Last updated {SITE.lastUpdated}</p>

      <div className="mt-6">
        <DraftNotice items={[
          'The operator name and contact address (lib/siteInfo.ts), and which organisation is the data controller and which the processor.',
          'The retention statements in section 7 are the intended policy. Student accounts and practice data are only actually deleted each summer once the year-end clean-up exists, and old audit entries are only removed once that job exists.',
          'Google’s terms for the Gemini API on a paid (billing-enabled) account: whether prompts and images are used to improve Google’s models, and where they are processed (the hosting region is London, but the Gemini API’s processing location is not pinned).',
          'The lawful basis for each use and any data processing agreement with the school.',
          'That the list of data in section 2 is complete for the school’s deployment.',
        ]}
        />
      </div>

      <div className="space-y-8 text-slate-700">
        <section>
          <H>1. Who this is for and who is responsible</H>
          <p className="mt-2">
            {SITE.appName} is an online system for marking scanned exam scripts and for student practice marking. It is run by{' '}
            <Fill value={SITE.operatorName} label="operator name" /> for {SITE.schoolName}. {SITE.schoolName} decides what
            pupil data is put into the system and why, and is responsible for it as the data controller;{' '}
            <Fill value={SITE.operatorName} label="operator name" /> handles it on the school&apos;s behalf and only for the purposes described here.
          </p>
        </section>

        <section>
          <H>2. What information we hold</H>
          <div className="mt-2 space-y-4">
            <div>
              <h3 className="font-semibold text-slate-900">Staff (teachers and administrators)</h3>
              <ul className="mt-1 list-disc space-y-1 pl-5">
                <li>Name, school email address and role, from their Google account when they sign in.</li>
                <li>An encrypted Google Drive access token, so the system can store and read exam files in their Drive.</li>
                <li>The marks, ticks and notes they enter, and a log of administrative actions and changes to exam questions, recorded against their account.</li>
              </ul>
            </div>
            <div>
              <h3 className="font-semibold text-slate-900">Students using the practice area</h3>
              <ul className="mt-1 list-disc space-y-1 pl-5">
                <li>Name, school email address and profile picture, from their Google account when they sign in. Nothing else is requested from Google, and no Drive access is ever asked for or stored for a student.</li>
                <li>Which class link they used to join, and the practice marks they give. These are kept apart from teachers&apos; marks and results and cannot change them.</li>
              </ul>
            </div>
            <div>
              <h3 className="font-semibold text-slate-900">Exam scripts and marking</h3>
              <ul className="mt-1 list-disc space-y-1 pl-5">
                <li>Images of candidates&apos; handwritten answers, uploaded by teachers as scanned PDFs, identified in the system by a number rather than a name. A name written on the paper appears in the image; areas set aside for names are hidden from everyone except the lead teacher, but a name written elsewhere on a page would be visible.</li>
                <li>Teachers&apos; marks and annotations, and AI suggestions, for each answer.</li>
              </ul>
            </div>
            <div>
              <h3 className="font-semibold text-slate-900">Technical</h3>
              <ul className="mt-1 list-disc space-y-1 pl-5">
                <li>A sign-in session (a random identifier and the browser type) for 7 days. We do not use advertising or analytics tracking.</li>
              </ul>
            </div>
          </div>
        </section>

        <section>
          <H>3. Information we receive from Google</H>
          <p className="mt-2">When you sign in with Google we receive:</p>
          <ul className="mt-1 list-disc space-y-1 pl-5">
            <li><strong>Everyone:</strong> your name, email address and profile picture (the <code>openid</code>, <code>email</code> and <code>profile</code> permissions), used only to recognise you and to show who is signed in.</li>
            <li><strong>Staff only:</strong> permission to create and use the files this app creates in your Google Drive, and any files you choose to give it (the <code>drive.file</code> permission). It does not let the app see the rest of your Drive. Used only to store and read exam scripts, clipped answer images and exports.</li>
          </ul>
          <p className="mt-2">
            We do not sell this information, use it for advertising, or share it except with the services that run the system (section 6).
            {' '}{SITE.appName}&apos;s use and transfer to any other app of information received from Google APIs will adhere to the{' '}
            <a className="text-indigo-700 underline" href="https://developers.google.com/terms/api-services-user-data-policy" target="_blank" rel="noreferrer">Google API Services User Data Policy</a>,
            including the Limited Use requirements.
          </p>
        </section>

        <section>
          <H>4. How we use it</H>
          <ul className="mt-2 list-disc space-y-1 pl-5">
            <li>To let teachers mark scripts and see progress and results, and to let students practise marking and compare their marking with teachers&apos;.</li>
            <li>To control who can see what: teachers see only the exams and questions they are assigned to; students see only the practice items shared with their class.</li>
            <li>To keep the service secure and to investigate problems.</li>
          </ul>
        </section>

        <section>
          <H>5. AI processing</H>
          <p className="mt-2">
            If a teacher uses the AI features, images of the answers being marked (with the mark scheme, any guidance the teacher wrote, and some
            example answers a teacher has already marked) are sent to Google&apos;s Gemini API to suggest marks, and handwriting can be read into text.
            Areas set aside for names are hidden in these images, but a name written outside them would be included. AI suggestions are never final: only
            a teacher&apos;s mark counts. <Fill value="" label="confirm Google's data use and location terms for the Gemini API" />
          </p>
        </section>

        <section>
          <H>6. Where it is stored and who handles it</H>
          <ul className="mt-2 list-disc space-y-1 pl-5">
            <li>Database and application: Google Cloud, in {SITE.hostingRegion}.</li>
            <li>Exam scripts and answer images: the lead teacher&apos;s Google Drive (and briefly in temporary storage on Google Cloud while they are processed).</li>
            <li>AI suggestions: Google&apos;s Gemini API (section 5).</li>
          </ul>
          <p className="mt-2">Information is not otherwise shared with anyone, and is not sold.</p>
        </section>

        <section>
          <H>7. How long we keep it</H>
          <ul className="mt-2 list-disc space-y-1 pl-5">
            <li>Student accounts and their practice data are deleted at the end of each school year.</li>
            <li>Sign-in sessions last 7 days.</li>
            <li>The log of administrative actions is kept for 12 months.</li>
            <li>Exam scripts, answer images and marks are kept until the teacher who runs the exam deletes it; the school&apos;s end-of-year routine asks teachers to delete finished exams. Files in a teacher&apos;s Google Drive stay under that teacher&apos;s control.</li>
          </ul>
        </section>

        <section>
          <H>8. Children</H>
          <p className="mt-2">
            Pupils use the service only through their school. Their data is used only for their school&apos;s marking and practice, is never used for advertising or
            profiling, and a student&apos;s practice marks are visible only to that student and their teachers.
          </p>
        </section>

        <section>
          <H>9. Cookies and similar storage</H>
          <p className="mt-2">
            One essential cookie keeps you signed in (it is not readable by scripts, and is only sent to this site). Your browser also keeps
            display preferences on your own device, such as your chosen tool and colour and where panels are placed. There are no advertising or tracking cookies.
          </p>
        </section>

        <section>
          <H>10. Security</H>
          <p className="mt-2">
            Connections are encrypted. Drive access tokens are stored encrypted. Access is limited by role and by assignment, and administrative actions are logged.
            No system is perfectly secure, and if a problem affects personal data the school will be told so it can act.
          </p>
        </section>

        <section>
          <H>11. Your rights and contact</H>
          <p className="mt-2">
            You can ask to see, correct or delete the information held about you, or object to how it is used. Ask your school first, or contact <ContactEmail />. If you
            are unhappy with the answer you can complain to the Information Commissioner&apos;s Office (ico.org.uk).
          </p>
        </section>

        <section>
          <H>12. Changes</H>
          <p className="mt-2">We will update this page if what we do changes, and show the date at the top.</p>
        </section>
      </div>
    </PublicLayout>
  );
}
