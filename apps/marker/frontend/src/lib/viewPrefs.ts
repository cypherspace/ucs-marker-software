import { useCallback, useState } from 'react';

/**
 * A small piece of view state (a sort order, a filter) remembered in this browser between visits.
 * Only a convenience: when storage is unavailable it behaves like ordinary state.
 */
export function useViewPref<T extends Record<string, string>>(key: string, defaults: T): [T, (patch: Partial<T>) => void] {
  const [value, setValue] = useState<T>(() => {
    try {
      const stored = JSON.parse(window.localStorage.getItem(key) ?? 'null') as Partial<T> | null;
      if (stored && typeof stored === 'object') {
        // Keep only known keys holding strings, so an old or edited value cannot break the page
        const merged = { ...defaults };
        for (const k of Object.keys(defaults)) {
          if (typeof stored[k] === 'string') (merged as Record<string, string>)[k] = stored[k] as string;
        }
        return merged;
      }
    } catch { /* unreadable: use the defaults */ }
    return defaults;
  });

  const update = useCallback((patch: Partial<T>) => {
    setValue((prev) => {
      const next = { ...prev, ...patch };
      try { window.localStorage.setItem(key, JSON.stringify(next)); } catch { /* storage unavailable */ }
      return next;
    });
  }, [key]);

  return [value, update];
}
