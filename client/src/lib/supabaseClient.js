import { createClient } from "@supabase/supabase-js";

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

export const supabase = createClient(supabaseUrl, supabaseAnonKey, {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: true,
  },
});

export function getRedirectUrl() {
  if (typeof window === "undefined") {
    return "http://localhost:5173";
  }

  const origin = window.location.origin;
  if (origin.includes("localhost") || origin.includes("127.0.0.1")) {
    return origin;
  }

  return origin;
}

export async function signOutUser() {
  if (typeof window !== "undefined") {
    localStorage.removeItem("user");
  }

  await supabase.auth.signOut();
}

export async function buildUserFromSession(session) {
  const user = session?.user;
  if (!user) {
    return null;
  }

  const metadata = user.user_metadata || {};
  const profile = {
    id: user.id,
    name: metadata.full_name || metadata.name || user.email?.split("@")[0] || "Google User",
    email: user.email || metadata.email || "",
    phone: metadata.phone || "",
    avatar_url: metadata.avatar_url || metadata.picture || "",
    provider: user.app_metadata?.provider || "google",
  };

  if (typeof window !== "undefined") {
    localStorage.setItem("user", JSON.stringify(profile));
  }

  try {
    await supabase.from("profiles").upsert(
      {
        id: profile.id,
        full_name: profile.name,
        email: profile.email,
        avatar_url: profile.avatar_url,
        created_at: new Date().toISOString(),
      },
      { onConflict: "id" }
    );
  } catch {
    // Ignore profile creation failures and let the authenticated session stand.
  }

  return profile;
}
