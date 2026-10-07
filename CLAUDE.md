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
- `/admin` is a frontend route; only `/admin/v1` is API (Vite proxy and the production page fallback both depend on that).
- Who may work on a question is decided in one place, `services/access.ts` (`requireQuestionAccess` / `requireClipAccess`): admin, the exam's lead teacher, or a teacher assigned to it. Use it for any route that touches clips, marks, AI or comparisons.
- Marks: a clip can have a teacher's mark and an AI mark. The mark that counts is moderated, else latest human, else AI (`services/finalMark.ts`). Progress "marked" figures count teachers' marks only. Never join `script_marks` directly in a report; use `finalMarks()`.
- AI runs (marking and judging) are driven by the browser in steps of up to 3 items (`/ai-mark/plan` then `/ai-mark/step`, and the `ai-judge` equivalents), not by background work, because Cloud Run throttles CPU after a response. Clip images for AI must go through `services/clipImages.ts` so Drive-stored clips work.
- Set `AI_STUB=1` to answer AI and transcription calls with deterministic fake output (no Gemini key needed) when testing locally.
- Comparative marking: `exam_questions.marking_mode` is `marks` or `comparative`. Pairs live in `comparative_pairs` (one per two scripts per question, any order); judgements in `comparative_judgements` (one human and one AI per pair; a human judgement overrides the AI's). Ranking is Bradley-Terry (`services/ranking.ts`, unit-tested).
- Deactivated users (`users.disabled_at`) keep their data but cannot sign in; every admin action and question edit/delete is written to `audit_log` via `services/audit.ts`.
- Drive picker (`components/DrivePicker.tsx`): returns references only; PDFs are downloaded one at a time at upload time (`hooks/useUploadQueue.ts`, one request per file in name order) because Cloud Run rejects request bodies over 32 MB. The token is cached with its expiry. The picker shows folders, Shared with me and shared drives; with the narrow `drive.file` scope the app only gets the files the user picks (picking a folder does not grant its contents).
- Unit tests: `npm test` (vitest, API only). Browser checks used Playwright against the dev servers.
- TypeScript: after adding a column in a migration, update the `Exam`/etc. interfaces in `packages/shared-types/src/index.ts`, or `tsc -b` fails in the frontend build.

## Production (GCP)

Project `ucs-marking-software` (number `988173603763`), region `europe-west2`. Live as of 2026-10-06.

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

They are not part of the pipeline. Production was migrated by tunnelling to Cloud SQL with `@google-cloud/cloud-sql-connector` (a small TCP forwarder around `connector.getOptions({ ipType: 'PUBLIC' }).stream()`, because `startLocalProxy` is Unix-socket only and fails on Windows), setting a temporary password on the built-in `postgres` user, running `infra/db/marker/migrate.mjs up` with `DATABASE_URL` pointing at the tunnel, then granting `marker-sa`:

```sql
GRANT ALL ON ALL TABLES IN SCHEMA public TO "marker-sa@ucs-marking-software.iam";
GRANT ALL ON ALL SEQUENCES IN SCHEMA public TO "marker-sa@ucs-marking-software.iam";
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO "marker-sa@ucs-marking-software.iam";
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON SEQUENCES TO "marker-sa@ucs-marking-software.iam";
```

Applied: 001 to 006 (005 and 006 on 2026-10-07, after an on-demand backup; note 006 also deletes duplicate AI mark rows, keeping the newest per clip). **007 (per-script clip overrides: five new columns on `script_clips`, additive) is NOT applied to production yet; apply it before merging the PR that contains it, because the new code selects those columns.** Any new migration must be applied the same way, then re-run the `GRANT` statements above so `marker-sa` can use new tables and columns. Changing database credentials or running migrations against production needs the user's explicit go-ahead.

### Secrets gotcha

Secrets created from PowerShell got a UTF-8 BOM, which broke the `TOKEN_ENCRYPTION_KEY` length check and crashed startup. They were re-created BOM-free (version 2). Add secrets from a BOM-free file (`gcloud secrets versions add <name> --data-file=<file>`) or via the console, and check the byte length.

### OAuth

- The project has no Google organisation (personal account), so the consent screen cannot be "Internal". It was published to production; scopes are non-sensitive (`openid email profile drive.file`) and users see an "unverified app" warning they can skip.
- The OAuth client must list both Cloud Run URLs as redirect URIs (`<url>/auth/google/callback`) and as JavaScript origins (Drive picker).
- Access control is the app's own `users` and `allowed_emails` tables. `ALLOW_SIGNUP` is false in production, so unknown Google accounts are rejected.

## Status and next steps (as of 2026-10-07)

**Update 2026-10-07 (after PR #3).** Migrations 005 and 006 are applied and PR #3 is merged; Cloud Build deployed it as revision `marker-api-00007-xcj` (previous good revision: `marker-api-00005-4cs`). Verified without signing in: `/health` 200, `/admin` serves the SPA, `/auth/me`, `/api/v1/home`, `/admin/v1/*` and `/files/` return 401, the extractor returns 403 to anonymous callers, no errors in the API logs. Granted `roles/iam.serviceAccountTokenCreator` to `marker-sa` on itself, which signed GCS URLs (`services/storage.ts`) need (it was missing). **Still to check by a signed-in person** (steps 3 below): sign-in after the `disabled_at` change, the region editor on a real script, clip images while marking, the Drive picker, AI marking/judging with real Gemini, and the CSV export.

**State before PR #3 merged.** Production ran the code from PR #2 (migrations 001 to 004). The list below was on `dev`, built and tested locally only (real Postgres, browser tests, unit tests; AI calls and Google were stubbed, so nothing had been tried against real Gemini, real Drive or the live extractor):

- Clipper: page images load with a visible error and Retry; page count bound; clearer errors when the extractor is unreachable; regions can be selected, moved, resized, deleted, undone, cleared; Re-clip after edits (`POST /exams/:id/clip` takes `question_ids`).
- Questions: rename, change marks, delete (blocked once teachers have marked; confirmation if clips exist); duplicate numbers refused.
- Homepage of status cards (`GET /api/v1/home`), shared button components (`components/ui.tsx`), clearer Exams page.
- Admin page (`/admin`: Staff, Marking overview, Activity), deactivation (migration 005), last-admin and self-demotion guards, audit log, `GET /api/v1/teachers` for non-admin lead teachers.
- AI marking page, typed-text (OCR) and AI-suggestion panels on the marking screen, comparative marking with pair generation, teacher-chosen judging quotas, AI judging of the rest, Bradley-Terry ranking (migration 006). Export is one row per clip (teacher's mark, else AI's) with `ai_marks_awarded`, and `rank`/`score` for comparative questions.
- Drive picker: folders, Shared with me, shared drives; one request per PDF with per-file progress and retry.

**Behaviour changes to know about.** Teachers must be assigned to a question (or lead the exam, or be admin) to mark it, see its clips or judge it. Only the lead teacher or an admin can run AI marking, set up comparisons or see rankings. AI marking needs a mark-scheme region on the question or typed guidance. `/admin` is now a frontend route.

**Next steps, in order:**

1. **Apply migrations 005 and 006 to production before merging.** The new code reads `users.disabled_at`, so deploying first breaks sign-in for everyone. Both migrations only add columns and tables, so the live app keeps working after they are applied. The agent environment has no Google Cloud access, so this is done from a machine with `gcloud` (PowerShell, from the repo root on an up-to-date `dev`):
   - Backup: `gcloud sql backups create --instance=marker-postgres --project=ucs-marking-software`
   - Temporary password: `gcloud sql users set-password postgres --instance=marker-postgres --project=ucs-marking-software --password=<TEMP>`
   - Tunnel to `ucs-marking-software:europe-west2:marker-postgres` (the connector forwarder described above, or the Cloud SQL Auth Proxy on a local port such as 5436).
   - `$env:DATABASE_URL="postgresql://postgres:<TEMP>@localhost:5436/marker_db"; npm run migrate:up` (expect `005_user_deactivation` and `006_ai_and_comparative`).
   - Re-run the four `GRANT` / `ALTER DEFAULT PRIVILEGES` statements above, check `select name from pgmigrations order by id;` ends at 006, then set the `postgres` password to a new random value.
2. **Merge PR #3.** Every push to `main` runs Cloud Build, which deploys both services. Watch the build (`gcloud builds list --project=ucs-marking-software`). To go back: `gcloud run services update-traffic marker-api --to-revisions=<previous>=100` (the migrations need no rollback).
3. **Check the live site.** `/health`; sign in; then:
   - Open the region editor on a real script. The live blank clipper was never diagnosed; the editor now shows the actual error. If it still fails, note the message and the status of `/api/v1/scripts/<id>/render?page=1` in the browser Network tab, and read `gcloud run services logs read marker-api --region europe-west2 --project ucs-marking-software --limit 50` (and the same for `marker-extractor`). Suspects: the ID-token call to the private extractor (audience or invoker), the extractor reading the script from GCS, a Drive-stored script whose lead teacher has no valid Drive token.
   - Check clip images appear while marking. Signed GCS URLs (`services/storage.ts`) need `signBlob` rights; `marker-sa` has no token-creator role listed, so this may fail.
   - Drive picker with a real account: open a nested folder, find an old PDF, pick several, upload, confirm scripts are numbered in name order and land in the exam's Drive folder; also Shared with me and a shared drive. The tab names depend on a Google picker option (`setLabel`) that was only tested against a stub.
   - AI marking and AI judging on a handful of clips with the real Gemini key: read the reasoning, confirm teachers' marks still win, and confirm nothing identifying is in the output.
   - Export CSV: new columns present, one row per clip.
4. Then pick from the open items below.

## Known limits / open items

- **Gemini key invalid (found 2026-10-07).** Google answers `API_KEY_INVALID` for the key in Secret Manager `marker-gemini-api-key` (it is identical to the one in the local `.env`, so it never worked). Typed text (OCR) and AI marking/judging fail until it is replaced with a valid key. Use a key from the school's own account on a paid plan: student work is sent to Gemini, and free-tier keys may use submitted content to improve Google's products. After replacing it, start a new Cloud Run revision so running instances pick up the new version, and check `marker-extractor` logs for `/ocr`.

- Cloud Run caps request bodies at 32 MB, so each uploaded PDF must be under about 31.9 MB (the upload screen says so). A server-side Drive import would remove this limit; it needs the uploader's stored Drive token and confirmation that Google's per-file grant also applies to the server's token.
- CORS is `origin: true` with credentials (not tightened; low risk with `SameSite=Lax` and same-origin hosting).
- Live end-to-end testing of script upload, clip generation (private extractor with ID-token auth) and Drive storage has still not been done.
- Deleting a question leaves its clip image files in storage.
- Comparative ranking is not yet converted into marks (no grade boundaries); no bulk OCR; no examiner-report upload for the AI.
- Not built: Drive connection status per teacher, "sign out everywhere" and pruning expired sessions (`pruneExpiredSessions` exists but is never called), reassigning an exam's lead teacher, bulk invite, AI usage and cost tracking.
- `requireAuth` is async without error handling, so a database failure while loading a session is an unhandled rejection.
- `GET /exams/:id`, `/progress` and `/questions` only require sign-in, not access to the exam.
- Separate repo, `caie-exam-builder`: `POST /papers/upload` has no admin check, so any signed-in teacher can ingest papers and trigger paid Gemini calls.
- Migrations and the Cloud Build pipeline: migrations are still manual. Running them in the pipeline would need the app's database account to own or alter tables.
- Branching: `main` is what is deployed (every push triggers a Cloud Build deploy). Develop on `dev`, then PR into `main` to release.

## Working in a fresh checkout

`git checkout dev && git pull`, `npm install` (if packages look incomplete, delete `node_modules` and run `npm ci`), `docker compose up -d postgres`, `npm run migrate:up`, then the three dev servers as described above. Use `AUTH_DISABLED=true` for a quick look and `AI_STUB=1` to try AI features without a Gemini key. To see the Drive picker locally, set `VITE_GOOGLE_CLIENT_ID`, `VITE_GOOGLE_API_KEY` and `VITE_GOOGLE_PROJECT_NUMBER` in the root `.env`. Checks: `npm run build`, `npm test`, and `npx tsc --noEmit` in `apps/marker/api`.
