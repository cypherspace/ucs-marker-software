import { useCallback, useEffect, useRef, useState } from 'react';

/**
 * Google Drive file picker — lets a teacher pick script PDFs straight from
 * their school Drive instead of downloading them locally first.
 *
 * Requires VITE_GOOGLE_CLIENT_ID (OAuth client, same one the API uses) and
 * VITE_GOOGLE_API_KEY (a browser API key with the Picker API enabled). When
 * either is missing the caller should fall back to a plain file input —
 * `driveConfigured` tells it which to render.
 *
 * Picked files are downloaded in the browser with the user's own Drive token
 * (drive.file scope) and handed to `onFiles` as File[], so the existing
 * multipart upload path is unchanged.
 */

const CLIENT_ID = import.meta.env.VITE_GOOGLE_CLIENT_ID as string | undefined;
const API_KEY = import.meta.env.VITE_GOOGLE_API_KEY as string | undefined;
const SCOPE = 'https://www.googleapis.com/auth/drive.file';

export const driveConfigured = Boolean(CLIENT_ID && API_KEY);

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

export function DrivePicker({ onFiles, disabled }: { onFiles: (files: File[]) => void; disabled?: boolean }) {
  const [ready, setReady] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const tokenRef = useRef<string | null>(null);

  // Pre-load the Picker + Identity Services scripts on mount so opening the
  // picker later doesn't stall.
  useEffect(() => {
    if (!driveConfigured) return;
    let cancelled = false;
    Promise.all([
      loadScript('https://apis.google.com/js/api.js').then(
        () => new Promise<void>((resolve) => window.gapi.load('picker', () => resolve())),
      ),
      loadScript('https://accounts.google.com/gsi/client'),
    ])
      .then(() => { if (!cancelled) setReady(true); })
      .catch((e) => { if (!cancelled) setError(e.message); });
    return () => { cancelled = true; };
  }, []);

  const getToken = useCallback((): Promise<string> => {
    if (tokenRef.current) return Promise.resolve(tokenRef.current);
    return new Promise((resolve, reject) => {
      const client = window.google.accounts.oauth2.initTokenClient({
        client_id: CLIENT_ID,
        scope: SCOPE,
        callback: (resp: { access_token?: string; error?: string }) => {
          if (resp.error || !resp.access_token) { reject(new Error(resp.error ?? 'No token')); return; }
          tokenRef.current = resp.access_token;
          resolve(resp.access_token);
        },
      });
      client.requestAccessToken();
    });
  }, []);

  const openPicker = useCallback(async () => {
    setError(null);
    setBusy(true);
    try {
      const token = await getToken();
      const picked = await new Promise<{ id: string; name: string }[]>((resolve) => {
        const picker = new window.google.picker.PickerBuilder()
          .addView(new window.google.picker.DocsView().setMimeTypes('application/pdf'))
          .setOAuthToken(token)
          .setDeveloperKey(API_KEY)
          .enableFeature(window.google.picker.Feature.MULTISELECT_ENABLED)
          .setCallback((data: any) => {
            if (data.action === window.google.picker.Action.PICKED) {
              resolve(data.docs.map((d: any) => ({ id: d.id, name: d.name })));
            } else if (data.action === window.google.picker.Action.CANCEL) {
              resolve([]);
            }
          })
          .build();
        picker.setVisible(true);
      });

      if (!picked.length) { setBusy(false); return; }

      const files = await Promise.all(picked.map(async (doc) => {
        const resp = await fetch(
          `https://www.googleapis.com/drive/v3/files/${doc.id}?alt=media`,
          { headers: { Authorization: `Bearer ${token}` } },
        );
        if (!resp.ok) throw new Error(`Download failed for ${doc.name} (${resp.status})`);
        const blob = await resp.blob();
        return new File([blob], doc.name.endsWith('.pdf') ? doc.name : `${doc.name}.pdf`, { type: 'application/pdf' });
      }));

      onFiles(files);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }, [getToken, onFiles]);

  if (!driveConfigured) return null;

  return (
    <div className="mb-3">
      <button
        type="button"
        onClick={openPicker}
        disabled={disabled || !ready || busy}
        className="inline-flex items-center gap-2 rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50"
      >
        <svg viewBox="0 0 24 24" className="h-4 w-4" aria-hidden>
          <path fill="#4285F4" d="M8.5 2 1 15l3.75 6.5L12.25 8.5z" />
          <path fill="#FBBC04" d="M15.5 2h-7l7.5 13h7z" />
          <path fill="#34A853" d="M4.75 21.5h15L23 15H8.5z" />
        </svg>
        {busy ? 'Loading from Drive…' : 'Choose from Google Drive'}
      </button>
      {error && <p className="mt-2 text-sm text-red-600">{error}</p>}
    </div>
  );
}
