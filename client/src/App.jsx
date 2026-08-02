import { useEffect, useState } from "react";
import Login from "./Login";
import { Routes, Route, Navigate } from "react-router-dom";
import Dashboard from "./Dashboard";
import Home from "./Home";
import MapGrid from "./MapGrid";
import Insights from "./Insights";
import Reports from "./Reports";
import Settings from "./Settings";
import { supabase, buildUserFromSession } from "./lib/supabaseClient";

export default function App() {

  const [user,setUser] = useState(() => {
    if (typeof window === "undefined") {
      return null;
    }

    try {
      return JSON.parse(localStorage.getItem("user"));
    } catch {
      return null;
    }
  });
  const [authReady, setAuthReady] = useState(false);

  useEffect(() => {
    let isMounted = true;

    const syncAuthState = async (session) => {
      if (!session?.user) {
        if (typeof window !== "undefined") {
          localStorage.removeItem("user");
        }
        if (isMounted) {
          setUser(null);
        }
        return;
      }

      const profile = await buildUserFromSession(session);
      if (profile && isMounted) {
        setUser(profile);
      }
    };

    const restoreSession = async () => {
      const { data: { session }, error } = await supabase.auth.getSession();
      if (!isMounted) return;

      if (error) {
        setAuthReady(true);
        return;
      }

      await syncAuthState(session);

      if (isMounted) {
        setAuthReady(true);
      }
    };

    restoreSession();

    const { data: { subscription } } = supabase.auth.onAuthStateChange(async (event, session) => {
      if (!isMounted) return;

      if (event === "SIGNED_OUT") {
        if (typeof window !== "undefined") {
          localStorage.removeItem("user");
        }
        setUser(null);
        setAuthReady(true);
        return;
      }

      await syncAuthState(session);
      if (isMounted) {
        setAuthReady(true);
      }
    });

    return () => {
      isMounted = false;
      subscription.unsubscribe();
    };
  }, []);

  if (!authReady) {
    return null;
  }

  if(!user){
    return <Login setUser={setUser} />;
  }

  return (

    <Routes>

      <Route path="/" element={<Home user={user} />} />

      <Route path="/dashboard" element={<Dashboard user={user} />} />

      <Route path="/alerts" element={<Dashboard user={user} focus="feed" />} />

      <Route path="/map" element={<MapGrid />} />

      <Route path="/insights" element={<Insights />} />

      <Route path="/reports" element={<Reports />} />

      <Route path="/settings" element={<Settings />} />

      <Route path="*" element={<Navigate to="/" replace />} />

    </Routes>

  );

}
