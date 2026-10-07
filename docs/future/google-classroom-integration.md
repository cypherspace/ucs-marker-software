# Future possibility: Google Classroom integration

**Status: idea only. Low priority, not planned, nothing built.** Written 2026-10-07 after a feasibility check against Google's documentation. Google changes these APIs, so re-check the linked pages before starting.

## The idea

A teacher picks one Google Classroom assignment, the app pulls in the students' submitted PDFs as scripts, the existing marking flow annotates them, and the marks optionally go back to Classroom.

## Verdict

| Part | Feasible? | Effort |
|---|---|---|
| Import submissions from a chosen assignment | Yes | Moderate |
| Annotate and mark them | Yes, existing pipeline unchanged | None |
| Export marks matched to the class list | Yes | Small |
| Write marks back into a **teacher-created** Classroom assignment | **Not with the plain API** (see below) | n/a |
| Write marks back via an app-created assignment | Yes | Small to moderate, but changes how teachers set work |
| Write marks back via a Classroom add-on | Yes | Large (a project) |

## Importing (feasible)

1. Teacher signs in with extra scopes: `classroom.courses.readonly`, `classroom.coursework.students.readonly`, and a Drive read scope.
2. The app lists the teacher's courses and assignments (course work), then calls `courses.courseWork.studentSubmissions.list`. Each submission has `assignmentSubmission.attachments[].driveFile.id`; teachers can also get the Drive folder where student work lands (`studentWorkFolder`).
3. Download each file with the Drive API using the teacher's token: `files.get` with `alt=media` for PDFs and images, `files.export` for Google Docs and Slides (export to PDF). Check `capabilities.canDownload` first.
4. Store the file in the exam's Drive folder (existing `uploadFile`) and create a `student_scripts` row. Put the Classroom user ID in the existing nullable `student_scripts.student_id` column and keep the `student_number` sequence, so markers stay anonymous and the lead teacher can map marks back to students for export.

Because the server does the download itself, this also gets around the 32 MB request limit that the browser-upload route has.

Things to handle: photos of handwriting (JPG/HEIC) need converting to PDF before the extractor can use them; several attachments per student; students who have not submitted; resubmission or returned work; Google-format attachments; `title` metadata sometimes missing, so key on the file ID.

### The scope problem

The app currently asks only for `drive.file`, which reaches files the app created or the user picked. It does **not** reach student-owned files. Reading them needs `drive.readonly`, a *restricted* scope.

- An app used by people outside its own Workspace organisation needs Google's restricted-scope verification and, because it stores the data on servers, a security assessment (weeks to months).
- An app whose user type is **Internal** (users from one Workspace organisation only) skips verification, but the domain admin must still allow it in Admin console > Security > API controls.
- `ucs-marking-software` belongs to a personal Google account with no organisation, so it cannot be Internal.

**Prerequisite: move the project under a school-owned Google Workspace for Education organisation** (or recreate it there), set the consent screen to Internal, and have an admin allow the app. This is wanted anyway (school data ownership, a paid school-owned Gemini key).

## Sending marks back (the hard part)

- `courses.courseWork.studentSubmissions.patch` can set `draftGrade` / `assignedGrade`, but returns `PERMISSION_DENIED` unless the **same Cloud project / OAuth client created that course work**. An assignment a teacher made in Classroom cannot be graded by our app this way.

Options:

- **A. App-created assignments.** The teacher creates the assignment from our app (via API), students submit in Classroom, we set the grades (as drafts the teacher can still change and return). Works with the plain API. Changes teacher workflow, and the app would need the write scope `classroom.coursework.students`.
- **B. Classroom add-on.** Our app becomes an add-on attached to the assignment; marks go back with `pointsEarned` on the add-on attachment (needs a positive `maxPoints`; only one attachment per assignment can control the grade; the grade arrives as a draft). Needs an interface inside Classroom, a Workspace Marketplace listing (private is possible when the project lives in a Workspace for Education domain), installation by each teacher or an admin, and teachers on Teaching & Learning or Plus licences. A real project.
- **C. Export only.** A marks sheet in class-list order that the teacher copies into Classroom. No integration risk, not automatic.

The API cannot attach our annotated PDF back to a student's submission, so students would not see annotations in Classroom whichever route is used.

## Suggested order if this is ever picked up

1. Move the project under the school organisation, set Internal, get admin approval (also unlocks paid Gemini and proper data ownership).
2. Import from a chosen assignment (read-only).
3. Marks export matched to the roster (route C).
4. Only then decide between A and B, based on how the school actually uses Classroom.

## Where it would touch the code

- Sign-in scopes: `apps/marker/api/src/routes/auth.ts` (currently `openid email profile drive.file`; adding scopes means a fresh consent for each teacher).
- Drive access: `apps/marker/api/src/services/drive.ts` (`getOAuth2Client`, `downloadFile`, `uploadFile`, `createExamFolder`), `services/scriptSource.ts`.
- Script creation: `apps/marker/api/src/routes/scripts.ts` (`POST /exams/:id/scripts` is the model for a server-side import route), `student_scripts.student_id`.
- Export: `apps/marker/api/src/routes/export.ts`.
- New UI: a "Import from Google Classroom" option beside the Drive picker on the exam setup page.

## Risks and open questions

- Student data privacy: pulling Classroom work into a third-party app needs the school's data-protection sign-off and admin app approval (Admin console > Security > API controls > App access control). For under-18 students the admin controls apply to the teacher's access path; check with the school's data lead.
- Is Classroom used with Google Docs submissions, scanned PDFs, or phone photos? That decides how much conversion work is needed.
- Does the school want teachers to create assignments in the app (route A), or keep creating them in Classroom (then only B or C)?

## Sources

- [Classroom API: studentSubmissions.patch](https://developers.google.com/classroom/reference/rest/v1/courses.courseWork.studentSubmissions/patch)
- [Classroom API: studentSubmissions.list](https://developers.google.com/workspace/classroom/reference/rest/v1/courses.courseWork.studentSubmissions/list)
- [Classroom add-ons: attachment grades and grade passback](https://developers.google.com/workspace/classroom/add-ons/walkthroughs/grade-passback)
- [Classroom add-ons: listing and publishing](https://developers.google.com/workspace/classroom/add-ons/get-started/add-on-listing)
- [Drive API: choose scopes](https://developers.google.com/workspace/drive/api/guides/api-specific-auth)
- [Google OAuth: production readiness and verification](https://developers.google.com/identity/protocols/oauth2/production-readiness/overview)
