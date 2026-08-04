import { createClient } from "@supabase/supabase-js";

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

// Names only — never the values. Rendered by App so a bad .env shows a
// readable message instead of a blank page.
const missingSupabaseEnv = [
  !supabaseUrl && "VITE_SUPABASE_URL",
  !supabaseAnonKey && "VITE_SUPABASE_ANON_KEY",
].filter(Boolean);

// Legacy service role keys are JWTs carrying role: "service_role"; the current
// format is a plain sb_secret_ string.
function isSecretKey(key) {
  if (typeof key !== "string") return false;
  if (key.startsWith("sb_secret_")) return true;

  try {
    return JSON.parse(atob(key.split(".")[1])).role === "service_role";
  } catch {
    return false;
  }
}

/**
 * A secret key in the browser is both a credential leak and a broken sign-in:
 * Supabase rejects it for the auth endpoints the client calls, so Google
 * returns successfully and no session is ever created. Caught here rather than
 * left to fail silently at the token exchange.
 */
export const configProblem = missingSupabaseEnv.length
  ? `Set ${missingSupabaseEnv.join(" and ")} in client/.env, then restart the dev server.`
  : isSecretKey(supabaseAnonKey)
  ? "VITE_SUPABASE_ANON_KEY holds a secret key. The browser must use the publishable key (sb_publishable_…) or the legacy anon JWT. Replace it, then rotate the exposed secret key in the Supabase dashboard."
  : "";

export const isSupabaseConfigured = configProblem === "";

// createClient throws when either value is undefined, so the client is only
// built once both are present. Every consumer goes through AuthProvider, which
// short-circuits when the project is unconfigured.
export const supabase = isSupabaseConfigured
  ? createClient(supabaseUrl, supabaseAnonKey, {
      auth: {
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: true,
      },
    })
  : null;

// Supabase sends the browser back here after Google finishes. This exact
// origin must also be listed under Authentication → URL Configuration →
// Redirect URLs in the Supabase dashboard, otherwise Supabase falls back to
// the project Site URL and the session lands on a different origin.
export function getRedirectUrl() {
  if (typeof window === "undefined") {
    return "http://localhost:5173/";
  }

  return `${window.location.origin}/`;
}

/**
 * Build the app's user object straight from the session.
 *
 * Deliberately synchronous and network free: this runs inside the
 * onAuthStateChange callback, which Supabase invokes while holding its auth
 * lock. Any nested Supabase call there would wait on a lock its own caller
 * holds and never resolve.
 */
export function mapSessionToUser(session) {
  const user = session?.user;
  if (!user) {
    return null;
  }

  const metadata = user.user_metadata || {};
  const provider = user.app_metadata?.provider || "";
  const isGuest = provider === "anonymous" || user.is_anonymous === true;

  return {
    id: user.id,
    name:
      metadata.full_name ||
      metadata.name ||
      user.email?.split("@")[0] ||
      (isGuest ? "Guest" : "Operator"),
    email: user.email || metadata.email || "",
    // Google never returns one; the name + phone sign-in supplies it here.
    phone: metadata.phone || "",
    avatar_url: metadata.avatar_url || metadata.picture || "",
    provider: provider || "google",
    isGuest,
  };
}

/**
 * OAuth failures come back as query or hash parameters on the redirect URL
 * rather than as a rejected promise, so they are read off the URL once at
 * startup and then cleared.
 */
export function takeOAuthError() {
  if (typeof window === "undefined") {
    return "";
  }

  const query = new URLSearchParams(window.location.search);
  const hash = new URLSearchParams(window.location.hash.replace(/^#/, ""));
  const description =
    query.get("error_description") || hash.get("error_description");
  const code = query.get("error") || hash.get("error");

  if (!code && !description) {
    return "";
  }

  window.history.replaceState({}, "", window.location.pathname);

  return description || code;
}
