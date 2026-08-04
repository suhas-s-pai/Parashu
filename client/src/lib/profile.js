/**
 * Per-account details that Supabase Auth does not provide.
 *
 * Google never returns a phone number, but the backend requires one on every
 * SOS so responders can call back. It is kept on the device, namespaced by the
 * Supabase user id so two accounts on one browser never share a number.
 *
 * This is profile data, not authentication — the session is the only thing
 * that decides whether someone is signed in.
 */

const PHONE_PREFIX = "parashu.phone.";

// Written by the removed name + phone login screen. Reading it used to be
// enough to enter the app, which conflicted with Supabase Auth, so it is
// cleared on startup.
const LEGACY_USER_KEY = "user";

export function clearLegacyAuth() {
  if (typeof window === "undefined") return;

  try {
    localStorage.removeItem(LEGACY_USER_KEY);
  } catch {
    // A blocked localStorage is not a reason to stop booting.
  }
}

export function readStoredPhone(userId) {
  if (typeof window === "undefined" || !userId) return "";

  try {
    return localStorage.getItem(`${PHONE_PREFIX}${userId}`) || "";
  } catch {
    return "";
  }
}

export function writeStoredPhone(userId, phone) {
  if (typeof window === "undefined" || !userId) return;

  try {
    if (phone) {
      localStorage.setItem(`${PHONE_PREFIX}${userId}`, phone);
    } else {
      localStorage.removeItem(`${PHONE_PREFIX}${userId}`);
    }
  } catch {
    // Ignore quota or private-mode failures; the number simply is not kept.
  }
}
