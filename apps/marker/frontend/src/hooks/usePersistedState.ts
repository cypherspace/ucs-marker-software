import { useCallback, useState } from 'react';

/**
 * State remembered in this browser under `key`, so a choice (the tool you picked, whether the mark scheme is open)
 * survives moving to the next script and coming back later. `accept` rejects stored values that are no longer valid.
 * The stored value is only a convenience: everything works when storage is unavailable.
 */
export function usePersistedState<T>(key: string, initial: T, accept: (v: unknown) => v is T = (v): v is T => true) {
  const [value, setValue] = useState<T>(() => {
    try {
      const raw = window.localStorage.getItem(key);
      if (raw !== null) {
        const parsed: unknown = JSON.parse(raw);
        if (accept(parsed)) return parsed;
      }
    } catch { /* unreadable or unavailable */ }
    return initial;
  });

  const set = useCallback((next: T) => {
    setValue(next);
    try { window.localStorage.setItem(key, JSON.stringify(next)); } catch { /* storage unavailable */ }
  }, [key]);

  return [value, set] as const;
}
