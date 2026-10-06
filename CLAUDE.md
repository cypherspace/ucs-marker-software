# CLAUDE.md

UCS Automatic Marking System: online marking of scanned student exam scripts with AI assistance. Node monorepo (npm workspaces) plus a Python extractor.

## Layout

- `apps/marker/api` — Express + TypeScript API (port 8080). In production it also serves the built frontend (SPA fallback).
- `apps/marker/frontend` — React 19 + Vite + Tailwind (port 5173 in dev, proxies `/api /admin /auth /files` to 8080).
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
- `/files/` requires auth and local reads are confined to the storage dir.
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

Applied: 001 to 004. Any new migration must be applied the same way. Changing database credentials or running migrations against production needs the user's explicit go-ahead.

### Secrets gotcha

Secrets created from PowerShell got a UTF-8 BOM, which broke the `TOKEN_ENCRYPTION_KEY` length check and crashed startup. They were re-created BOM-free (version 2). Add secrets from a BOM-free file (`gcloud secrets versions add <name> --data-file=<file>`) or via the console, and check the byte length.

### OAuth

- The project has no Google organisation (personal account), so the consent screen cannot be "Internal". It was published to production; scopes are non-sensitive (`openid email profile drive.file`) and users see an "unverified app" warning they can skip.
- The OAuth client must list both Cloud Run URLs as redirect URIs (`<url>/auth/google/callback`) and as JavaScript origins (Drive picker).
- Access control is the app's own `users` and `allowed_emails` tables. `ALLOW_SIGNUP` is false in production, so unknown Google accounts are rejected.

## Known limits / open items

- Cloud Run caps request bodies at 32 MB. Script PDF uploads above that fail with 413 (not fixed).
- CORS is `origin: true` with credentials (not tightened; low risk with `SameSite=Lax` and same-origin hosting).
- Live end-to-end testing of script upload, clip generation (private extractor with ID-token auth) and Drive storage had not been done when this was written.
- The working branch `claude/brave-meitner-62xn07` is what is deployed. It has not been merged to `main`, so the trigger has never fired automatically.
