# Handoff: releasing PR #22 (student practice marking)

Written 2026-11-13 by a cloud session for the local session on the owner's own computer. If you were asked to "update" or "carry on", this is what is outstanding. Delete this file once the release is done.

## State

- PR #22 (`claude/brave-meitner-62xn07` into `main`) is open, clean and **not merged**. It holds three pieces of work and three migrations:
  - `011_mark_combine`: `exams.mark_combine` (how several teachers' marks combine: latest / average / lead).
  - `012_student_role`: adds `student` to the `user_role` enum.
  - `013_practice_marking`: tables `practice_sets`, `practice_set_items`, `practice_links`, `practice_enrolments`, `student_marks`.
- `main` deploys on merge (Cloud Build, about 5 minutes). The new code queries those columns and tables, so **the migrations must be on production before the merge**. They are additive, so the old code keeps working once they are applied.
- Tested in the cloud session: `npm test`, `npm run build`, `apps/marker/api/scripts/practice-api-check.py` (about 60 API checks with real seeded sessions), `student-fence-sweep.py` (72 routes, 0 reachable by a student) and a Playwright run of the whole student flow. **Not tested: real Google sign-in.**
- The cloud session has no gcloud credentials, so it could not apply the migrations. The owner said they could not do it from the computer they were using at the time.

## Next steps, in order

1. `git fetch; git checkout claude/brave-meitner-62xn07; git pull; npm ci` so `infra/db/marker/migrate-cloudsql.mjs` and migrations 011 to 013 are present.
2. **Apply the migrations to production. This needs the owner's explicit go-ahead in the session (CLAUDE.md working agreements); the owner has asked for it, so confirm and proceed.** Follow the header of `infra/db/marker/migrate-cloudsql.mjs` (PowerShell):
   - Back up: `gcloud sql backups create --instance=marker-postgres --project=ucs-marking-software`
   - Set a temporary password on the built-in `postgres` user: `gcloud sql users set-password postgres --instance=marker-postgres --project=ucs-marking-software --password=$pw`
   - `$env:PGPW = $pw; node infra/db/marker/migrate-cloudsql.mjs; Remove-Item Env:PGPW`
   - It runs `migrate up` (011, 012, 013) and the `GRANT` statements for `marker-sa`. The last lines should list applied migrations ending in `013_practice_marking`.
   - If this computer cannot run it, use Google Cloud Shell in a browser (it has gcloud and node): clone the repo, `npm ci`, the same steps with `PGPW=... node infra/db/marker/migrate-cloudsql.mjs`. Or paste the migrations' SQL into Cloud SQL Studio (database `marker_db`, user `postgres`): run `ALTER TYPE user_role ADD VALUE IF NOT EXISTS 'student';` on its own first, then the rest, then `INSERT INTO pgmigrations (name, run_on)` rows for the three migrations and the four `GRANT` / `ALTER DEFAULT PRIVILEGES` statements from CLAUDE.md. The SQL for Studio has **not** been generated yet; produce it from a local `migrate up` against a throwaway Postgres and compare it with the real result.
3. Check production before merging (read-only): `pgmigrations` has 011, 012 and 013; `exams.mark_combine` exists; the five practice tables exist; `\dT+ user_role` shows `student`.
4. Merge PR #22 into `main` (only after step 3 passes). Then check the deploy: `gcloud builds list`, `gcloud run services describe marker-api`, `/health`, 401 on a protected route without a cookie, and the error logs (`gcloud logging read`).
5. Fast-forward `dev` to `main` (`git merge --ff-only origin/main`).
6. Ask the owner to check on the live site with a real `@ucs.org.uk` account that is **not** on the staff list:
   - It signs in as a student with no Drive permission prompt.
   - A class link (`/join/<token>`, made on an exam's "Student practice" tab) opens a set, a clip can be marked and submitted, and only then is the teachers' mark shown.
   - A staff sign-in and the Drive picker still work as before.
7. Remove this file and update the CLAUDE.md "Applied to production" line to say 011 to 013 are applied.

## If it goes wrong

Send traffic back to the previous revision: `gcloud run services update-traffic marker-api --to-revisions=<previous>=100 --region=europe-west2 --project=ucs-marking-software`. The migrations need no rollback.

## Known limits to mention to the owner

- A student name written outside a name zone is visible to students in practice sets, and they may recognise handwriting, so the lead teacher should skim a set before sharing a link.
- Student names, emails and marks are new personal data; there is no retention rule or "delete student" action yet.
