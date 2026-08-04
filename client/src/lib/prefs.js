/**
 * Console preferences, stored on this device only — there is no settings
 * endpoint to sync them to. The control room and the settings page read and
 * write the same record so a toggle flipped in one place holds in the other.
 */

import { useCallback, useEffect, useState } from "react";

const PREFS_KEY = "parashu.prefs";
const LEGACY_PREFS_KEY = "kalisos.prefs";

export const DEFAULT_PREFS = {
  sirenOnNewAlert: true,
  desktopNotifications: false,
  reduceMotion: false,
  realtime: true,
};

export function readPrefs() {
  if (typeof window === "undefined") return { ...DEFAULT_PREFS };

  try {
    const stored =
      localStorage.getItem(PREFS_KEY) || localStorage.getItem(LEGACY_PREFS_KEY);
    return { ...DEFAULT_PREFS, ...(JSON.parse(stored) || {}) };
  } catch {
    return { ...DEFAULT_PREFS };
  }
}

export function writePrefs(prefs) {
  if (typeof window === "undefined") return;

  try {
    localStorage.setItem(PREFS_KEY, JSON.stringify(prefs));
    localStorage.removeItem(LEGACY_PREFS_KEY);
  } catch {
    // Preferences are a convenience; a blocked localStorage is not fatal.
  }
}

export function usePrefs() {
  const [prefs, setPrefs] = useState(readPrefs);

  useEffect(() => {
    writePrefs(prefs);
  }, [prefs]);

  const togglePref = useCallback((key) => {
    setPrefs((current) => ({ ...current, [key]: !current[key] }));
  }, []);

  return [prefs, togglePref];
}
