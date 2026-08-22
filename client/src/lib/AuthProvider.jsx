import { useCallback, useEffect, useMemo, useState } from "react";
import { AuthContext } from "./authContext";
import {
  getRedirectUrl,
  isSupabaseConfigured,
  mapSessionToUser,
  supabase,
  takeOAuthError,
} from "./supabaseClient";
import { clearLegacyAuth, readStoredPhone, writeStoredPhone } from "./profile";

/**
 * The single source of truth for who is signed in.
 *
 * Two things keep the session stable across a Google redirect and a refresh:
 *
 *   1. getSession() restores whatever Supabase already persisted, including
 *      the session it just exchanged out of the OAuth redirect URL.
 *   2. onAuthStateChange() keeps that state current for sign in, sign out and
 *      silent token refreshes.
 *
 * The state callback stays synchronous on purpose. Supabase runs it while
 * holding its internal auth lock, so awaiting another Supabase call from
 * inside it deadlocks: the app never learns it is signed in and stays on the
 * login screen even though Google succeeded. The admin lookup below therefore
 * lives in its own effect, outside that lock.
 */
export function AuthProvider({ children }) {
  const [session, setSession] = useState(null);
  const [status, setStatus] = useState(
    isSupabaseConfigured ? "loading" : "unconfigured"
  );
  const [authError, setAuthError] = useState("");
  const [phone, setPhone] = useState("");
  // Tagged with the account it was resolved for, so "still checking" is a
  // derived value and never a separate flag that can fall out of sync.
  const [adminRole, setAdminRole] = useState({ forUserId: null, isAdmin: false });

  useEffect(() => {
    clearLegacyAuth();

    const oauthError = takeOAuthError();
    if (oauthError) {
      setAuthError(oauthError);
    }

    if (!isSupabaseConfigured) {
      return undefined;
    }

    let active = true;

    supabase.auth
      .getSession()
      .then(({ data, error }) => {
        if (!active) return;

        if (error) {
          setAuthError(error.message);
        }

        setSession(data?.session ?? null);
        setStatus("ready");
      })
      .catch((error) => {
        if (!active) return;

        setAuthError(error?.message || "Could not restore your session.");
        setStatus("ready");
      });

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((event, nextSession) => {
      if (!active) return;

      setSession(nextSession ?? null);
      setStatus("ready");

      if (event === "SIGNED_IN") {
        setAuthError("");
      }
    });

    return () => {
      active = false;
      subscription.unsubscribe();
    };
  }, []);

  const userId = session?.user?.id ?? null;

  useEffect(() => {
    setPhone(readStoredPhone(userId));
  }, [userId]);

  /**
   * Admin membership. RLS lets an account see only its own row, so a missing
   * row means "not an admin" and never leaks who the other admins are.
   */
  useEffect(() => {
    if (!userId) return undefined;

    let active = true;

    const resolveRole = async () => {
      try {
        const { data } = await supabase
          .from("admins")
          .select("user_id")
          .eq("user_id", userId)
          .maybeSingle();

        if (active) {
          setAdminRole({ forUserId: userId, isAdmin: Boolean(data) });
        }
      } catch {
        if (active) {
          setAdminRole({ forUserId: userId, isAdmin: false });
        }
      }
    };

    resolveRole();

    return () => {
      active = false;
    };
  }, [userId]);

  // Signed out accounts need no lookup, so they are ready immediately.
  const roleReady = !userId || adminRole.forUserId === userId;
  const isAdmin = adminRole.forUserId === userId && adminRole.isAdmin;

  const user = useMemo(() => {
    const base = mapSessionToUser(session);
    if (!base) return null;

    // The saved number wins; the sign-in metadata is the fallback for an
    // account that has not edited it on this device yet.
    return { ...base, phone: phone || base.phone || "", isAdmin };
  }, [session, phone, isAdmin]);

  const savePhone = useCallback(
    (value) => {
      const next = String(value || "").trim();
      writeStoredPhone(userId, next);
      setPhone(next);
    },
    [userId]
  );

  const signInWithGoogle = useCallback(async () => {
    setAuthError("");

    const { error } = await supabase.auth.signInWithOAuth({
      provider: "google",
      options: { redirectTo: getRedirectUrl() },
    });

    if (error) {
      setAuthError(error.message || "Google sign-in could not be started.");
      throw error;
    }
  }, []);

  /**
   * Name + phone sign-in, backed by a real Supabase anonymous session rather
   * than a localStorage flag. That gives the same session lifecycle as Google
   * — it survives refresh, refreshes its token, and carries a real user id
   * the backend can attribute an alert to.
   */
  const signInWithNamePhone = useCallback(async (name, phoneNumber) => {
    setAuthError("");

    const { data, error } = await supabase.auth.signInAnonymously({
      options: { data: { full_name: name, name, phone: phoneNumber } },
    });

    if (error) {
      setAuthError(
        /anonymous/i.test(error.message || "")
          ? "Name + phone sign-in is disabled. Enable Anonymous Sign-Ins in Supabase → Authentication → Sign In / Providers."
          : error.message || "Could not sign in with those details."
      );
      throw error;
    }

    // Seed the device store so an SOS can be raised without re-entering it.
    const newUserId = data?.user?.id;
    if (newUserId) {
      writeStoredPhone(newUserId, phoneNumber);
      setPhone(phoneNumber);
    }
  }, []);

  /**
   * Administrator sign-in via Google OAuth.
   * Supabase Auth manages the Google OAuth session; membership of the public.admins
   * table is verified after session restoration.
   */
  const signInAsAdmin = useCallback(async () => {
    setAuthError("");

    const { error } = await supabase.auth.signInWithOAuth({
      provider: "google",
      options: { redirectTo: getRedirectUrl() },
    });

    if (error) {
      setAuthError(error.message || "Google administrator sign-in could not be started.");
      throw error;
    }
  }, []);

  const signOut = useCallback(async () => {
    try {
      await supabase.auth.signOut();
    } catch (error) {
      // An already expired session rejects here. The local session still has
      // to go, and the state reset below is what actually signs the user out.
      console.warn("Sign out reported an error:", error?.message || error);
    }

    setSession(null);
    setAdminRole({ forUserId: null, isAdmin: false });
    setAuthError("");
  }, []);

  const value = useMemo(
    () => ({
      user,
      session,
      status,
      authError,
      isAdmin,
      roleReady,
      savePhone,
      signInWithGoogle,
      signInWithNamePhone,
      signInAsAdmin,
      signOut,
    }),
    [
      user,
      session,
      status,
      authError,
      isAdmin,
      roleReady,
      savePhone,
      signInWithGoogle,
      signInWithNamePhone,
      signInAsAdmin,
      signOut,
    ]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}
