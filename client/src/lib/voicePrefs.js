import { useCallback, useEffect, useState } from "react";

/**
 * Voice Protection card preferences. Purely local display/behaviour settings
 * for the settings modal — there is no backend concept of "sensitivity" (the
 * Web Speech API doesn't expose one), so this only shapes the UI and the
 * auto-enable-on-load behaviour, never the recognition match logic itself.
 */

const KEY = "parashu.voicePrefs";

export const DEFAULT_VOICE_PREFS = {
  sensitivity: "medium",
  autoEnable: false,
};

function readVoicePrefs() {
  if (typeof window === "undefined") return { ...DEFAULT_VOICE_PREFS };

  try {
    return { ...DEFAULT_VOICE_PREFS, ...(JSON.parse(localStorage.getItem(KEY)) || {}) };
  } catch {
    return { ...DEFAULT_VOICE_PREFS };
  }
}

function writeVoicePrefs(prefs) {
  if (typeof window === "undefined") return;

  try {
    localStorage.setItem(KEY, JSON.stringify(prefs));
  } catch {
    // A blocked localStorage just means the preference resets next visit.
  }
}

export function useVoicePrefs() {
  const [prefs, setPrefs] = useState(readVoicePrefs);

  useEffect(() => {
    writeVoicePrefs(prefs);
  }, [prefs]);

  const setSensitivity = useCallback((sensitivity) => {
    setPrefs((current) => ({ ...current, sensitivity }));
  }, []);

  const setAutoEnable = useCallback((autoEnable) => {
    setPrefs((current) => ({ ...current, autoEnable }));
  }, []);

  return { prefs, setSensitivity, setAutoEnable };
}
