# CLAUDE.md

UCS Automatic Marking System: online marking of scanned student exam scripts with AI assistance. Node monorepo (npm workspaces) plus a Python extractor.

## Layout

- `apps/marker/api` — Express + TypeScript API (port 8080). In production it also serves the built frontend (SPA fallback).
- `apps/marker/frontend` — React 19 + Vite + Tailwind (port 5173 in dev, proxies `/api /admin/v1 /auth /files` to 8080; reads `VITE_*` from the repo-root `.env`).
- `services/extractor` — Python FastAPI (PyMuPDF, Gemini): renders pages, clips regions, OCR. Port 8081 locally, `$PORT` on Cloud Run.
- `infra/db/marker` — node-pg-migrate migrations (`00N_*.cjs`).
- `packages/shared-types`, `packages/shared-middleware` — source-only packages (no build script, no `dist`). The frontend uses `shared-types` as type-only imports; the API does not import either at runtime.
- `cloudbuild.yaml`, `apps/marker/api/Dockerfile`, `services/extractor/Dockerfile` — deployment.

## Run locally

- Postgres: `docker compose up -d postgres` (host port **5435**). Migrate with `npm run migrate:up`.
- Extractor: own venv (`py -3.14 -m venv services/extractor/.venv`, then `pip install -r requirements.txt`); `npm run dev:extractor`.
- API: `npm run dev:api`. Set `AUTH_DISABLED=true` in `.env` to inject an admin user and skip Google OAuth.
- Frontend: `npm run dev:frontend` (Vite binds IPv6, so use `localhost`, not `127.0.0.1`).
- Copy `.env.example` to `.env`. Never commit `.env`.

## Code gotchas

- All API routers mount at `/api/v1`. `examsRouter` has a greedy `GET /:id`, so it must be mounted last.
- jsonb columns must be `JSON.stringify`'d before insert/update.
- Knex `.first()` over a leftJoin needs explicit column selects.
- Coordinate spaces: the extractor renders at 150 DPI; DB clip regions are PDF points (72 DPI). Convert with x72/150 (done in CoordinatePicker `toClipRegions` / `fromQuestionRegions`).
- Multi-region clipping: a question can have several `ClipRegion`s across pages; the extractor stitches them vertically.
- The API calls the extractor via `services/extractor.ts` (`extractorFetch`), which adds a Cloud Run ID token when `EXTRACTOR_URL` is https. Do not use bare `fetch` for extractor calls.
- `/files/` requires auth and local reads are confined to the storage dir. There must be no other route that serves files by path: a second, unauthenticated `/api/v1/files/*` once did, and exposed every server file (including `/proc/self/environ`, i.e. the secrets) until it was removed on 2026-10-07. Every new route needs `requireAuth` (or a router-level guard).
- Per-script clips (typed, scribed or incomplete scripts): `script_clips.regions` / `name_zones` (migration 007) override the question's regions for one script; `clip_source` is `auto` or `manual`. Set via `PUT/DELETE/GET /scripts/:scriptId/questions/:questionId/clip` (`routes/clipEdit.ts`), allowed for anyone assigned to the question; only the lead teacher or an admin can change a script's name zones. The bulk `POST /exams/:id/clip` skips manual pairs (the extractor's `skip` list), so a re-clip never overwrites them. Re-selecting a clip keeps existing marks and sets `reclipped_at`; "changed after marking" means a human mark's `marked_at` is earlier than `reclipped_at` (shown on the marking screen and the progress page). UI: `components/ScriptClipEditor.tsx` (marking screen "Script pages" button, and "Clip this script differently…" in the setup region editor).
- Anonymity when browsing a script: `GET /scripts/:id/render` blacks out every known name zone (all questions' plus the script's own) for anyone who is not the lead teacher or an admin, and refuses teachers not assigned to the exam. The lead can preview it with `?masked=1`. The old route that returned the whole unmasked PDF (`/clips/:id/script`) was removed. Name zones are per page, so a name printed anywhere else is visible.
- Clip images and Drive: never hand the browser a Drive or bucket URL for a clip. The canvas reads the image with `crossOrigin`, the bucket has no CORS rules, and Drive token-in-URL links fail, so the clip simply did not appear on the live marking page. The image is streamed by `GET /clips/:id/image` (same origin, needs the login cookie). For server-to-server fetches of Drive files use `getDriveMediaRequest()` (a clean URL plus an `Authorization` header, see `services/scriptSource.ts`), never a token in the URL; `getDownloadUrl` was deleted.
- Marking page (`pages/MarkingInterface.tsx`, route `/mark/:examId/:questionId/:clipId?`): the queue endpoint takes `?clip_id=` and returns `position`, `total`, `prev_id`, `next_id`, `next_unmarked_id`, `state` and the teacher's own `my_mark`; `GET /exams/:examId/questions/:questionId/clips` feeds the jump menu. Leaving a clip auto-saves a **draft** (`POST /marks` with `draft: true`: ticks and any mark are kept, status `pending`; it never un-marks a clip that was already saved; the queue's "remaining", the homepage and progress all ignore `pending` rows). The `mark_tick` annotation is worth exactly 1 mark and the Marks box follows the number of them unless a mark is typed (`markTickTotal` in `components/AnnotationCanvas.tsx`); there are no half marks. All per-clip state lives in `MarkingPanel`, keyed by clip id, so ticks cannot carry over to another script. Layout: the annotation toolbar and the script are separate panes (`AnnotationCanvas` is a fixed-height row; only the script pane scrolls), so the tools stay in view on a tall multi-page clip. Do not put the canvas back inside an outer `overflow-auto` container.
- Clip generation runs in steps because a whole class exceeds Cloud Run's 300 s request limit: `POST /exams/:id/clip/plan`, `/clip/step` (up to 5 scripts, the UI sends 3) and `/clip/finish` (mark scheme, then the exam becomes `marking`), lead teacher or admin only; the setup page drives them with `useBatchRunner` and `components/ClipRunPanel.tsx`. The single-call `POST /exams/:id/clip` remains for small jobs.
- Setting up questions (`components/QuestionClipper.tsx`, opened from `ExamSetup`): one drawing window with three modes. **add**: the question number and marks are typed in the window and its regions drawn on a real script; "Add question" creates it (`POST /:examId/questions` with `clip_coordinates` and `name_zones`) and starts the next (number suggested, name zone carried forward), "Save" commits the one in progress and stops. **edit**: Question and Name zone only; saves `clip_coordinates` / `name_zones` and must never send `ms_clip_coordinates`. **mark-scheme**: draws on the real mark scheme PDF (`GET /exams/:id/mark-scheme/render?page=N`, lead teacher or admin only) one question at a time and saves `ms_clip_coordinates` only; "Save & finish" runs `POST /exams/:id/mark-scheme/clip`, which clips the mark scheme without touching scripts or the exam status (a question whose region was cleared loses its old image). `CoordinatePicker` takes `sourceKey` + `loadPage`, so it can draw on any document. Before 2026-10-08 the "Mark scheme" tab drew on a *script* (the mark scheme PDF was never rendered), so mark-scheme regions could not really be defined. Uploading or replacing the mark scheme is now lead teacher / admin only.
- `/admin` is a frontend route; only `/admin/v1` is API (Vite proxy and the production page fallback both depend on that).
- Who may work on a question is decided in one place, `services/access.ts` (`requireQuestionAccess` / `requireClipAccess`): admin, the exam's lead teacher, or a teacher assigned to it. Use it for any route that touches clips, marks, AI or comparisons.
- Marks: a clip can have a teacher's mark and an AI mark. The mark that counts is moderated, else latest human, else AI (`services/finalMark.ts`). Progress "marked" figures count teachers' marks only. Never join `script_marks` directly in a report; use `finalMarks()`.
- AI runs (marking and judging) are driven by the browser in steps of up to 3 items (`/ai-mark/plan` then `/ai-mark/step`, and the `ai-judge` equivalents), not by background work, because Cloud Run throttles CPU after a response. Clip images for AI must go through `services/clipImages.ts` so Drive-stored clips work.
- Set `AI_STUB=1` to answer AI and transcription calls with deterministic fake output (no Gemini key needed) when testing locally.
- Gemini: both the API (`config.geminiModel`, AI marking) and the extractor (`_gemini_model_name()`, typed text) read `GEMINI_MODEL`, default `gemini-3.8-flash`. Google retires models quickly: `gemini-2.5-flash` (the old default) already answers 404 "no longer available" for new keys and is due to shut down on 2026-10-16. Check https://ai.google.dev/gemini-api/docs/deprecations every term, and note that the Cloud Build deploy uses `--set-env-vars`, which **replaces** all env vars, so a `GEMINI_MODEL` set by hand on a service is lost on the next deploy; change the default in code instead. To test a key and the models it can use without printing it, call `GET https://generativelanguage.googleapis.com/v1beta/models?key=...`; a mistyped key answers `API_KEY_INVALID` (this happened on 2026-10-07: the key was typed by hand). The key lives only in Secret Manager `marker-gemini-api-key` and the local `.env` (never in git; the repo is public) and a new secret version needs a new Cloud Run revision to be picked up.
- Gemini errors: never show a raw SDK error. `services/aiErrors.ts` turns any Gemini failure into `{code, message, retry_after_seconds, retryable, fatal}` (codes `AI_RATE_LIMITED`, `AI_QUOTA_EXHAUSTED`, `AI_OVERLOADED`, `AI_TIMEOUT`, `AI_NETWORK`, `AI_KEY_INVALID`, `AI_MODEL_UNAVAILABLE`, `AI_BLOCKED`, `AI_TOO_LARGE`, `AI_BAD_REPLY`, `AI_NOT_CONFIGURED`); unit-tested against the real SDK message format. `callModel` retries busy/short-rate-limit errors up to 3 times inside the request; the extractor (`/ocr`, `_generate_with_retry`) does the same and returns Gemini's own error as `detail: {code: 'GEMINI_ERROR', ...}`, which the API classifies (single source of wording). AI step endpoints return the code/flags per item; `useBatchRunner` puts retryable items back, waits (countdown in `components/AiRunNotice.tsx`), slows to one item at a time after a rate limit, and stops on fatal errors (daily quota, bad key, retired model). Single actions use `components/ErrorNotice.tsx` + `lib/errors.ts` (`friendlyError`). Add new Gemini calls through this path.
- The current key is a free-tier AI Studio key from a staff member's school account, used for the experiment only. Student work is sent to Gemini, and Google's terms for the UK/EEA say paid services only, so replace it with a key from a billing-enabled, school-owned Cloud project before real marking.
- Comparative marking: `exam_questions.marking_mode` is `marks` or `comparative`. Pairs live in `comparative_pairs` (one per two scripts per question, any order); judgements in `comparative_judgements` (one human and one AI per pair; a human judgement overrides the AI's). Ranking is Bradley-Terry (`services/ranking.ts`, unit-tested).
- Deactivated users (`users.disabled_at`) keep their data but cannot sign in; every admin action and question edit/delete is written to `audit_log` via `services/audit.ts`.
- Drive picker (`components/DrivePicker.tsx`): returns references only; PDFs are downloaded one at a time at upload time (`hooks/useUploadQueue.ts`, one request per file in name order) because Cloud Run rejects request bodies over 32 MB. The token is cached with its expiry. The picker shows folders, Shared with me and shared drives; with the narrow `drive.file` scope the app only gets the files the user picks (picking a folder does not grant its contents).
- Unit tests: `npm test` (vitest, API only). Browser checks used Playwright against the dev servers.
- TypeScript: after adding a column in a migration, update the `Exam`/etc. interfaces in `packages/shared-types/src/index.ts`, or `tsc -b` fails in the frontend build.

## Production (GCP)

Project `ucs-marking-software` (number `988173603763`), region `europe-west2`. Live since 2026-10-06.

- Cloud Run `marker-api` (API + frontend, public) and `marker-extractor` (private: no unauthenticated access, ingress `all`, IAM only). Both run as `marker-sa@ucs-marking-software.iam.gserviceaccount.com`.
- Cloud SQL `marker-postgres` (Postgres 15), database `marker_db`, IAM auth as DB user `marker-sa@ucs-marking-software.iam`. `marker-sa` needs `cloudsql.client` and `cloudsql.instanceUser`.
- GCS bucket `ucs-marking-software-storage` for scripts and clips.
- Secret Manager: `marker-gemini-api-key`, `marker-oauth-client-id`, `marker-oauth-client-secret`, `marker-token-encryption-key`.
- Live URLs (both valid): `https://marker-api-vgknas4dvq-nw.a.run.app` and `https://marker-api-988173603763.europe-west2.run.app`. The app builds its OAuth redirect from `PUBLIC_URL` (the first form).

### Deploy

- Cloud Build trigger `0aa39af3-aee8-48b2-b41d-2cba5a0e2426` fires on push to `^main$` only. Run manually: `gcloud builds triggers run 0aa39af3-aee8-48b2-b41d-2cba5a0e2426 --branch=<branch> --project=ucs-marking-software`.
- The org policy forces a user-managed build service account (`marker-sa`), hence `defaultLogsBucketBehavior: REGIONAL_USER_OWNED_BUCKET` in `cloudbuild.yaml`. `marker-sa` also needs `artifactregistry.writer`, `run.admin`, `logging.logWriter`, `storage.admin`, `secretmanager.secretAccessor` and `iam.serviceAccountUser` on itself.
- `VITE_GOOGLE_*` values are Cloud Build trigger substitutions (baked into the frontend at build time), not in the repo.
- Shell variables inside `cloudbuild.yaml` bash steps must be written `$$VAR`, otherwise Cloud Build treats them as substitutions.
- To validate before pushing: `docker build --file=apps/marker/api/Dockerfile .` and `docker build --file=services/extractor/Dockerfile services/extractor`, then run with `PORT=8080`.

### Migrations are manual

They are not part of the pipeline. Production is migrated by tunnelling to Cloud SQL with `@google-cloud/cloud-sql-connector` (a small TCP forwarder around `connector.getOptions({ ipType: 'PUBLIC' }).stream()`, because `startLocalProxy` is Unix-socket only and fails on Windows), setting a temporary password on the built-in `postgres` user, running `infra/db/marker/migrate.mjs up` with `DATABASE_URL` pointing at the tunnel, then granting `marker-sa`. Run it with `node infra/db/marker/migrate-cloudsql.mjs`, which does all of that:

```sql
GRANT ALL ON ALL TABLES IN SCHEMA public TO "marker-sa@ucs-marking-software.iam";
GRANT ALL ON ALL SEQUENCES IN SCHEMA public TO "marker-sa@ucs-marking-software.iam";
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO "marker-sa@ucs-marking-software.iam";
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON SEQUENCES TO "marker-sa@ucs-marking-software.iam";
```

Applied to production: 001 to 010 (005, 006 and 007 on 2026-10-07, each after an on-demand backup; note 006 also deleted duplicate AI mark rows, keeping the newest per clip; 008, 009 and 010 were applied by the owner, reported on 2026-10-09). **Apply a new migration to production BEFORE merging the PR whose code needs it**, because the deploy happens on merge and the new code would query columns that do not exist yet (migrations here are additive, so the old code keeps working once they are applied). The whole procedure (backup, temporary `postgres` password, tunnel, `migrate up`, the `GRANT` statements above so `marker-sa` can use new tables and columns) is scripted in `infra/db/marker/migrate-cloudsql.mjs`; read its header for the exact PowerShell steps. Changing database credentials or running migrations against production needs the user's explicit go-ahead.

### Secrets gotcha

Secrets created from PowerShell got a UTF-8 BOM, which broke the `TOKEN_ENCRYPTION_KEY` length check and crashed startup. They were re-created BOM-free (version 2). Add secrets from a BOM-free file (`gcloud secrets versions add <name> --data-file=<file>`) or via the console, and check the byte length.

### OAuth

- The project has no Google organisation (personal account), so the consent screen cannot be "Internal". It was published to production; scopes are non-sensitive (`openid email profile drive.file`) and users see an "unverified app" warning they can skip.
- The OAuth client must list both Cloud Run URLs as redirect URIs (`<url>/auth/google/callback`) and as JavaScript origins (Drive picker).
- Access control is the app's own `users` and `allowed_emails` tables. `ALLOW_SIGNUP` is false in production, so unknown Google accounts are rejected.

## Status and next steps (as of 2026-10-09)

**Where things are.** The system is live on Cloud Run and a teacher can run a whole exam through it. `main` and `dev` are at the same code (`3ed492c`, the merge of PR #17, at the time of writing) and `main` has been deployed. Check the live revisions with `gcloud run revisions list --service=marker-api --region=europe-west2 --project=ucs-marking-software` (and `--service=marker-extractor`). Migrations 001 to 010 are applied.

**Confirmed working on the live site by the user (a real signed-in session, as of 2026-10-07; nothing from the 2026-10-08 clean-up has been recorded as checked live yet):** Google sign-in, exam setup, the Drive picker and Drive-stored scripts, the region editor, drawing per-script clips for typed/scribed/incomplete scripts, Generate Clips, clip images on the marking page, Prev / Next / jump between scripts, Mark ticks (1 mark each, total fills the Marks box), ticks persisting per script, the annotation tools staying in view while scrolling a long script, and **typed text (handwriting recognition)** with the new Gemini key and model.

**Not yet tried live (do these next):**
1. **AI marking and AI judging.** Blocked only because the test exam has no mark scheme yet. AI marking needs a mark-scheme region on the question (upload the mark scheme PDF, draw the MS region, Generate Clips) or typed guidance. Run it on a handful of clips, read the reasoning, confirm a teacher's mark always wins over the AI's, and confirm nothing identifying (names) is in the output. It uses the same key and model as typed text, which is known to work, but the AI marking prompts have only been tested with `AI_STUB=1`.
2. CSV export (new columns, one row per clip), comparative marking (pair generation, judging, ranking), and the admin page (staff, marking overview, activity).
3. Generate Clips on a whole class (it now runs in small steps with a progress bar; tested locally and on small exams, not yet on a full class).
4. The new question clipper and mark-scheme clipping (2026-10-08): "Add questions" (draw question after question), "Clip the mark scheme" (draw on the real mark scheme), and the per-question "Mark scheme" button. Tested locally in a browser and through the API (13 checks); not yet tried on the live site.
5. The 2026-10-08 clean-up (PRs #11 to #17, now deployed): the Marking and Exams pages and exam tabs, archive / restore / delete, upload under a class name and the Results page and export, "Convert handwriting to text" and the docking mark-scheme panel. Tested locally; not yet recorded as checked on the live site. Also check that scripts uploaded before migration 010 show as "No class" as expected.

**Before real student work (decisions for the owner):**
- **Replace the Gemini key.** The key in use is a free-tier AI Studio key from a staff member's school account, accepted for the experiment only. Student work is sent to Gemini and Google's terms for the UK/EEA require paid services, so use a key from a billing-enabled, school-owned Cloud project. The Generative Language API is already enabled on `ucs-marking-software`. Replacing it: put the key in the local `.env` (git-ignored), then add a new `marker-gemini-api-key` secret version (BOM-free, see below) and start a new Cloud Run revision. Never paste it into chat or commit it.
- **The GitHub repo is public.** `CLAUDE.md` describes the live setup (project number, URLs, service-account and secret names; no secret values). Consider making the repo private; the Cloud Build trigger and cloud sessions both still work with a private repo.
- **Project ownership.** `ucs-marking-software` belongs to a personal Google account with no organisation. For school data, move it under a school-owned organisation or recreate it there.
- Model retirement: see the Gemini bullet under Code gotchas. `gemini-2.5-flash` is already refused for new keys.

**What the app does now (for orientation).**
- Teachers must be assigned to a question (or lead the exam, or be admin) to mark it, see its clips or judge it. Only the lead teacher or an admin can run AI marking, set up comparisons, see rankings or generate clips.
- Marking: per-script clips, Mark ticks, drafts auto-saved when moving between scripts, typed text, AI suggestion panel, mark-scheme panel. Export is one row per clip (teacher's mark, else AI's) with `ai_marks_awarded`, plus `rank`/`score` for comparative questions.
- Admin: staff list, invites, deactivation, last-admin and self-demotion guards, audit log, marking overview.

**Structure after the 2026-10-08 clean-up (PRs #11 to #17, all merged to `main`).**
- Navigation: one `PageHeader` on every page (Back that returns where you came from via react-router state, breadcrumbs). Links must be `LinkButton`/`AppLink` (they record the page they were clicked on); `lib/nav.ts` has the helpers.
- **Marking** (`/marking`): tabs My marking, AI marking (lead/admin; `/marking/ai/:id` is the per-exam AI page), Comparative ranking. **Exams** (`/exams`): list with search, status filter, sort, Active/Archived switch and a More menu (archive, restore, delete). One exam is `/exams/:id` with tabs Progress, Results, Setup (lead/admin) and Upload scripts (assigned non-lead teachers). Old addresses (`/my-exams`, `/exams/:id/progress`, `/exams/:id/ai`) redirect.
- Archive (`exams.archived_at`): leaves lists and Home, marks refused (409 `EXAM_ARCHIVED`), scripts refused. Delete needs the exam archived first if it has marks, the exam name typed, writes an audit entry, cascades, then removes stored files (Drive files are left).
- Classes: scripts are uploaded under a class name (`student_scripts.class_group`, `uploaded_by`). Results (`GET /exams/:id/results`, `/export`): lead/admin see everything; other teachers see the scripts they uploaded plus the questions they are assigned. Names stay lead/admin only. `requireExamMember` in `services/access.ts` guards reading an exam, its progress, questions, assignments, scripts and results.
- Marking page: marks box, Save and tools in a left column (no bottom bar); ticks, crosses and mark ticks are placed and removed by double-click; script zoom (Ctrl+wheel); the mark scheme is a `DockablePanel` (docked right by default, drag the title bar to any edge, float, resize; remembered in `localStorage` key `marker.panel.ms`). "Convert handwriting to text" reads the handwriting once, saves the text and a rendered page image (extractor `/render-text`, DejaVu Sans; `script_clips.text_image_url`), then "See converted handwriting" marks that page (annotations carry `layer: 'text'`; its mark ticks count towards the same total). The conversion is discarded only when the clip image really changes (`script_clips.clip_signature`) or on "Convert again".
- Frontend unit tests (vitest) cover the pure helpers in `apps/marker/frontend/src/lib`.
- Migrations 008 to 010 (008 `script_clips.text_image_url`/`clip_signature`, 009 `exams.archived_at`, 010 `student_scripts.class_group`/`uploaded_by`) are applied to production, so PRs #14, #16 and #17 could be merged.

**How work is done here (working agreements).**
- `main` is deployed: every push or merge to `main` runs Cloud Build and deploys both services (about 5 minutes). Develop on `dev` or a short-lived branch, open a PR into `main`, and **only merge when the owner says so**. After a deploy, check `/health`, the 401s on protected routes, the revision and the error logs (see the checks used in earlier merges: `gcloud builds list`, `gcloud run services describe`, `gcloud logging read`).
- **Production changes need the owner's explicit go-ahead**: running migrations, changing secrets or IAM, setting service env vars, resetting the `postgres` password. Read-only checks (logs, build status, revision lists, bucket and key listings) are fine. An automatic safety classifier may also block these actions; do not work around a denial, explain it and let the owner approve or run the command.
- Roll back a bad deploy by sending traffic to the previous revision: `gcloud run services update-traffic marker-api --to-revisions=<previous>=100 --region=europe-west2 --project=ucs-marking-software`. Migrations here are additive and need no rollback.
- Local test recipe that has worked well: a throwaway Postgres container on port 5436, `npm run migrate:up` against it, seed users and `sessions` rows by SQL (real session cookies `sid=...`, so the access rules are exercised, not bypassed with `AUTH_DISABLED`), run the extractor on 8081 and the built API on 8080 (`AI_STUB=1`), drive it with a small Python script, then check the UI in a browser. Remove the container afterwards.
- On the owner's Windows machine commands run in PowerShell 5.1: no `&&`, native stderr shows as red `NativeCommandError` noise even on success, a leading `Start-Sleep` is blocked (run long waits in the background), and double quotes inside an inline `git commit -m` message break; use `git commit -F <file>` (and `gh pr create --body-file`) for anything multi-line.

## Known limits / open items

- Cloud Run caps request bodies at 32 MB, so each uploaded PDF must be under about 31.9 MB (the upload screen says so). A server-side Drive import would remove this limit; it needs the uploader's stored Drive token and confirmation that Google's per-file grant also applies to the server's token.
- Each hand re-selected clip (or bulk re-clip) uploads a new clip file to Drive and leaves the previous one behind. Deleting a question also leaves its clip image files in storage.
- Name zones are per page, so a student name printed outside a defined zone is visible to markers (also in the Script pages viewer). Check the cover page of typed or scribed scripts and have the lead teacher draw a name zone for that script.
- CORS is `origin: true` with credentials (not tightened; low risk with `SameSite=Lax` and same-origin hosting).
- Comparative ranking is not yet converted into marks (no grade boundaries); no bulk OCR; no examiner-report upload for the AI.
- Not built: Drive connection status per teacher, "sign out everywhere" and pruning expired sessions (`pruneExpiredSessions` exists but is never called), reassigning an exam's lead teacher, bulk invite, AI usage and cost tracking, half marks.
- `requireAuth` is async without error handling, so a database failure while loading a session is an unhandled rejection.
- Existing scripts (uploaded before class names) have no class or uploader: they show as "No class" and only the lead teacher and admins (or a teacher assigned a question) see their results.
- Archiving an exam stops marks being saved and hides it from lists; AI marking, clipping and comparative judging are not blocked on archived exams (the UI just does not link to them).
- Separate repo, `caie-exam-builder`: `POST /papers/upload` has no admin check, so any signed-in teacher can ingest papers and trigger paid Gemini calls.
- Migrations are still manual (`infra/db/marker/migrate-cloudsql.mjs`); running them in the pipeline would need the app's database account to own or alter tables.
- Branching: `main` is what is deployed. Cloud sessions and day-to-day work start from `dev` (kept equal to `main` after each release: fast-forward it with `git merge --ff-only origin/main`), then PR into `main` to release.

## Future possibilities (low priority, not planned)

- **Google Classroom integration** (import a chosen assignment's submissions, annotate, maybe return marks): feasibility check and a phased outline are in `docs/future/google-classroom-integration.md`. Key facts: importing is feasible but needs the project moved under a school Workspace organisation (Internal user type) to use a restricted Drive scope; the plain Classroom API cannot grade assignments the app did not create, so marks back needs app-created assignments or a Classroom add-on, otherwise a marks export. Do not start it without the owner asking.

## Working in a fresh checkout

`git checkout dev && git pull`, `npm install` (if packages look incomplete, delete `node_modules` and run `npm ci`), `docker compose up -d postgres`, `npm run migrate:up`, then the three dev servers as described above. Use `AUTH_DISABLED=true` for a quick look and `AI_STUB=1` to try AI features without a Gemini key. To see the Drive picker locally, set `VITE_GOOGLE_CLIENT_ID`, `VITE_GOOGLE_API_KEY` and `VITE_GOOGLE_PROJECT_NUMBER` in the root `.env`. Checks: `npm run build`, `npm test`, and `npx tsc --noEmit` in `apps/marker/api`.
