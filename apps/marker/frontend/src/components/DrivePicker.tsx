import { useCallback, useEffect, useState } from 'react';

/**
 * Google Drive file picker: lets a teacher pick PDFs straight from their school
 * Drive, browsing folders, "Shared with me" and shared drives.
 *
 * Requires VITE_GOOGLE_CLIENT_ID (the same OAuth client the API uses) and
 * VITE_GOOGLE_API_KEY (a browser API key with the Picker API enabled). When
 * either is missing the caller should fall back to a plain file input:
 * `driveConfigured` tells it which to render.
 *
 * The picker returns references only. The PDFs are downloaded one at a time,
 * when they are uploaded, with `downloadDriveFile` (the user's own token, the
 * narrow drive.file scope: the app can only read what the user picked).
 */

const CLIENT_ID = import.meta.env.VITE_GOOGLE_CLIENT_ID as string | undefined;
const API_KEY = import.meta.env.VITE_GOOGLE_API_KEY as string | undefined;
// Google Cloud project number. With the narrow drive.file scope, Google only
// authorises picked files for this app when the picker is told the app ID.
const APP_ID = import.meta.env.VITE_GOOGLE_PROJECT_NUMBER as string | undefined;
const SCOPE = 'https://www.googleapis.com/auth/drive.file';
const TOKEN_MARGIN_SECONDS = 60;

export const driveConfigured = Boolean(CLIENT_ID && API_KEY);

export interface DriveRef {
  id: string;
  name: string;
  size: number | null;
}

declare global {
  interface Window {
    gapi?: any;
    google?: any;
  }
}

function loadScript(src: string): Promise<void> {
  return new Promise((resolve, reject) => {
    if (document.querySelector(`script[src="${src}"]`)) { resolve(); return; }
    const el = document.createElement('script');
    el.src = src;
    el.async = true;
    el.onload = () => resolve();
    el.onerror = () => reject(new Error(`Failed to load ${src}`));
    document.head.appendChild(el);
  });
}

// Loaded once, on first use.
let scriptsReady: Promise<void> | null = null;
function ensureScripts(): Promise<void> {
  if (!scriptsReady) {
    scriptsReady = Promise.all([
      loadScript('https://apis.google.com/js/api.js').then(
        () => new Promise<void>((resolve) => window.gapi.load('picker', () => resolve())),
      ),
      loadScript('https://accounts.google.com/gsi/client'),
    ]).then(() => undefined).catch((e) => { scriptsReady = null; throw e; });
  }
  return scriptsReady;
}

// ── Access token: cached with its expiry, renewed when it runs out ──────────
let cached: { token: string; expiresAt: number } | null = null;
let pending: Promise<string> | null = null;

function requestToken(): Promise<string> {
  if (pending) return pending;
  pending = new Promise<string>((resolve, reject) => {
    const client = window.google.accounts.oauth2.initTokenClient({
      client_id: CLIENT_ID,
      scope: SCOPE,
      callback: (resp: { access_token?: string; expires_in?: number | string; error?: string }) => {
        pending = null;
        if (resp.error || !resp.access_token) { reject(new Error(resp.error ?? 'Google did not return access')); return; }
        const seconds = Number(resp.expires_in ?? 3600);
        cached = { token: resp.access_token, expiresAt: Date.now() + (seconds - TOKEN_MARGIN_SECONDS) * 1000 };
        resolve(resp.access_token);
      },
      error_callback: (err: { type?: string; message?: string }) => {
        pending = null;
        reject(new Error(err?.message ?? (err?.type === 'popup_closed' ? 'The Google sign-in window was closed' : 'Google sign-in failed')));
      },
    });
    client.requestAccessToken();
  });
  return pending;
}

async function getToken(): Promise<string> {
  await ensureScripts();
  if (cached && cached.expiresAt > Date.now()) return cached.token;
  return requestToken();
}

async function driveFetch(url: string): Promise<Response> {
  let res = await fetch(url, { headers: { Authorization: `Bearer ${await getToken()}` } });
  if (res.status === 401) {
    cached = null;
    res = await fetch(url, { headers: { Authorization: `Bearer ${await getToken()}` } });
  }
  return res;
}

export async function downloadDriveFile(ref: DriveRef): Promise<File> {
  const res = await driveFetch(`https://www.googleapis.com/drive/v3/files/${encodeURIComponent(ref.id)}?alt=media`);
  if (!res.ok) {
    throw new Error(
      res.status === 403 || res.status === 404
        ? 'Google Drive did not allow access to this file. It may have been moved or deleted; pick it again.'
        : `Download from Google Drive failed (${res.status})`,
    );
  }
  const blob = await res.blob();
  return new File([blob], /\.pdf$/i.test(ref.name) ? ref.name : `${ref.name}.pdf`, { type: 'application/pdf' });
}

// ── Picker ──────────────────────────────────────────────────────────────────
function buildPicker(token: string, multiple: boolean, title: string, onPicked: (refs: DriveRef[]) => void) {
  const P = window.google.picker;

  // A PDF view that shows folders so the whole Drive can be browsed.
  const pdfView = (label: string, tweak: (v: any) => void) => {
    const v = new P.DocsView(P.ViewId.DOCS)
      .setIncludeFolders(true)
      .setMimeTypes('application/pdf')
      .setMode(P.DocsViewMode.LIST)
      .setEnableDrives(true);
    tweak(v);
    if (typeof v.setLabel === 'function') v.setLabel(label);
    return v;
  };

  const recent = new P.DocsView(P.ViewId.DOCS).setMimeTypes('application/pdf').setMode(P.DocsViewMode.LIST);
  if (typeof recent.setLabel === 'function') recent.setLabel('Recent PDFs');

  const builder = new P.PickerBuilder()
    .addView(pdfView('My Drive', (v) => v.setOwnedByMe(true)))
    .addView(pdfView('Shared with me', (v) => v.setOwnedByMe(false)))
    .addView(recent)
    .setOAuthToken(token)
    .setDeveloperKey(API_KEY)
    .setAppId(APP_ID)
    .enableFeature(P.Feature.SUPPORT_DRIVES)
    .setTitle(title)
    .setSize(1050, 650)
    .setLocale('en-GB')
    .setCallback((data: any) => {
      if (data.action === P.Action.PICKED) {
        onPicked((data.docs as any[]).map((d) => ({ id: d.id, name: d.name, size: Number(d.sizeBytes) || null })));
      } else if (data.action === P.Action.CANCEL) {
        onPicked([]);
      }
    });
  if (multiple) builder.enableFeature(P.Feature.MULTISELECT_ENABLED);
  return builder.build();
}

export function DrivePicker({
  onPick, multiple = true, disabled, title = 'Choose PDFs', buttonLabel = 'Choose from Google Drive',
}: {
  onPick: (refs: DriveRef[]) => void;
  multiple?: boolean;
  disabled?: boolean;
  title?: string;
  buttonLabel?: string;
}) {
  const [ready, setReady] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Load Google's scripts up front so opening the picker doesn't stall.
  useEffect(() => {
    if (!driveConfigured) return;
    let cancelled = false;
    ensureScripts()
      .then(() => { if (!cancelled) setReady(true); })
      .catch((e) => { if (!cancelled) setError(e.message); });
    return () => { cancelled = true; };
  }, []);

  const openPicker = useCallback(async () => {
    setError(null);
    setBusy(true);
    try {
      const token = await getToken();
      const picked = await new Promise<DriveRef[]>((resolve) => {
        buildPicker(token, multiple, title, resolve).setVisible(true);
      });
      if (picked.length) onPick(picked);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }, [multiple, title, onPick]);

  if (!driveConfigured) return null;

  return (
    <div className="mb-3">
      <button
        type="button"
        onClick={openPicker}
        disabled={disabled || !ready || busy}
        className="inline-flex min-h-11 items-center gap-2 rounded-lg border border-slate-300 bg-white px-4 text-sm font-medium text-slate-700 shadow-sm hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 focus-visible:ring-offset-2 disabled:opacity-50 sm:min-h-9"
      >
        <svg viewBox="0 0 24 24" className="h-4 w-4" aria-hidden>
          <path fill="#4285F4" d="M8.5 2 1 15l3.75 6.5L12.25 8.5z" />
          <path fill="#FBBC04" d="M15.5 2h-7l7.5 13h7z" />
          <path fill="#34A853" d="M4.75 21.5h15L23 15H8.5z" />
        </svg>
        {busy ? 'Opening Drive…' : buttonLabel}
      </button>
      {error && <p role="alert" className="mt-2 text-sm text-red-600">{error}</p>}
    </div>
  );
}
