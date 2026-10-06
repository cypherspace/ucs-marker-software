# Google setup and first local run

This walks you from nothing to a working local copy that signs in with your teacher Google account and stores scripts in that account's Drive. You do all the Google Cloud steps in your existing project; nothing here touches your other apps.

Time: about 30-40 minutes. Do the steps in order.

## What you will end up with

| Thing | Where it comes from | Goes in `.env` as |
|---|---|---|
| Sign-in client ID + secret | Google Cloud, new OAuth client (step 3) | `GOOGLE_OAUTH_CLIENT_ID`, `GOOGLE_OAUTH_CLIENT_SECRET`, `VITE_GOOGLE_CLIENT_ID` |
| Picker API key | Google Cloud, new API key (step 4) | `VITE_GOOGLE_API_KEY` |
| Project number | Google Cloud home page (step 4) | `VITE_GOOGLE_PROJECT_NUMBER` |
| Gemini key | Your existing one is fine | `GOOGLE_API_KEY` |
| Drive token lock | You generate it yourself (step 5) | `TOKEN_ENCRYPTION_KEY` |
| Database address | Your Cloud SQL instance (step 2) | `DATABASE_URL` |

## 1. Pick the project

Use your existing Google Cloud project (the one with Cloud SQL and Gemini). Check the project selector at the top of the console shows it. Everything below happens inside it.

Turn on two APIs (APIs & Services > Library, search each, click Enable):

- Google Drive API
- Google Picker API

## 2. Database (new database in your existing Cloud SQL instance)

Use a fresh database. The migrations create tables named `users`, `sessions` and so on, which would clash with another app.

1. Cloud SQL > your instance > Databases > Create database. Name: `marker_db`.
2. Cloud SQL > your instance > Users > Add user account (built-in). User name `marker`, choose a password and keep it.
3. To reach it from your computer, install the Cloud SQL Auth Proxy (search "Cloud SQL Auth Proxy download") and run it, replacing the instance connection name with yours (shown on the instance overview page, format `project:region:instance`):

   ```
   ./cloud-sql-proxy --port 5435 PROJECT:REGION:INSTANCE
   ```

   Leave that terminal open. The database is now available at `localhost:5435`.
4. Your `DATABASE_URL` is then:

   ```
   DATABASE_URL=postgresql://marker:YOUR_PASSWORD@localhost:5435/marker_db
   ```

Alternative if you would rather not touch Cloud SQL yet: `docker compose up postgres` from the repo root gives a throwaway local database on port 5435 with `DATABASE_URL=postgresql://marker:marker@localhost:5435/marker_db`.

## 3. Sign-in credentials (OAuth)

1. APIs & Services > OAuth consent screen (may be called "Google Auth Platform").
2. User type: **External**. App name: `UCS Marking`. Support email: yours. Save.
3. Scopes: add `openid`, `email`, `profile` and `.../auth/drive.file` ("See, edit, create and delete only the specific Google Drive files you use with this app"). Do not add any wider Drive scope.
4. Test users: add your **teacher account email** (and your personal one if you want to sign in with it too). While the app is in Testing status only these addresses can sign in.
5. Credentials > Create credentials > OAuth client ID > Web application. Name: `UCS Marking local`.
   - Authorised JavaScript origins: `http://localhost:5173`
   - Authorised redirect URIs: `http://localhost:5173/auth/google/callback`
6. Copy the client ID and client secret.

Heads-up: apps in Testing status make Google expire the stored Drive connection after 7 days, so you would have to sign in again weekly. Fine for trying it out. Before real use, publish the consent screen (Audience > Publish app). Because only the narrow `drive.file` scope is used you should not need the expensive security review, but check the console for what it asks at that point.

## 4. Picker key and project number

1. Credentials > Create credentials > API key. Click Edit on it:
   - Application restrictions: Websites, add `http://localhost:5173/*`
   - API restrictions: Restrict key > Google Picker API
2. Copy the key.
3. Project number: Cloud console home > Project info card (a long number, not the project ID).

## 5. Make the Drive token lock

This is a random password the app uses to encrypt each teacher's stored Drive connection. Google does not provide it. Run:

```
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

Put the 64 characters in `TOKEN_ENCRYPTION_KEY`. Keep it private and back it up. If you lose it, teachers just reconnect Drive once. The app refuses to start in production without it.

## 6. Fill in `.env`

From the repo root: `cp .env.example .env`, then set:

```
DATABASE_URL=postgresql://marker:YOUR_PASSWORD@localhost:5435/marker_db
AUTH_DISABLED=false
PUBLIC_URL=http://localhost:5173

GOOGLE_OAUTH_CLIENT_ID=...
GOOGLE_OAUTH_CLIENT_SECRET=...
GOOGLE_API_KEY=...            # your existing Gemini key
TOKEN_ENCRYPTION_KEY=...

VITE_GOOGLE_CLIENT_ID=...     # same value as GOOGLE_OAUTH_CLIENT_ID
VITE_GOOGLE_API_KEY=...       # the Picker key from step 4
VITE_GOOGLE_PROJECT_NUMBER=...
```

`.env` is git-ignored. Never commit it.

## 7. Who can sign in

The first migration pre-creates these accounts, so they can sign in without an invite: `cypherspace@gmail.com` (admin), and the three `@ucs.org.uk` teachers. If your teacher account is not one of those, the simplest fix is to set `ALLOW_SIGNUP=true` in `.env` while testing, so any listed test user becomes a teacher on first sign-in. (The invite list exists in the API but there is no Admin screen for it yet.)

Only a teacher or admin can create exams, so sign in with the teacher account for the Drive test.

## 8. Run it

You need Node 20+ and Python 3.10+. From the repo root, in separate terminals:

```
npm install
pip install -r services/extractor/requirements.txt
npm run migrate:up
npm run dev:extractor
npm run dev:api
npm run dev:frontend
```

Open http://localhost:5173 and click sign in with Google.

## 9. What to check on the first sign-in

1. Google's consent screen says the app can access "only the specific Google Drive files you use with this app". If it asks for all your files, stop: the wrong scope is configured.
2. Create an exam with "Store files in school Google Drive" ticked.
3. Upload a script PDF. A `UCS Marking` folder with an exam subfolder should appear in the teacher account's Drive, containing the PDF.
4. Choose from Google Drive in the upload panel: the picker opens and picked PDFs upload.
5. Generate clips, then mark one. Clip images are stored in the same exam folder.
6. Export results from the progress page: a CSV lands in the exam folder.

If step 3 does not create a folder, the API log shows a line starting `[drive]` saying why (most often: no stored token because you signed in before the Drive permission was granted; sign out and sign in again).

## Known limits

- Sign-in must use the same origin as the redirect URI you registered. Use `localhost:5173` consistently, not `127.0.0.1`.
- The AI features need a Gemini key with billing enabled for real volume.
- Hosting it for real teachers (a server, a domain, Cloud Run or similar) is a separate later step and is not covered here.
