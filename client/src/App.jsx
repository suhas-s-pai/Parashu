import { Navigate, Route, Routes, useLocation } from "react-router-dom";
import { ShieldAlert } from "lucide-react";
import Login from "./Login";
import Dashboard from "./Dashboard";
import Home from "./Home";
import AdminInvitePage from "./AdminInvitePage";
import MapGrid from "./MapGrid";
import Insights from "./Insights";
import Reports from "./Reports";
import Settings from "./Settings";
import { useAuth } from "./lib/authContext";
import { configProblem } from "./lib/supabaseClient";

function Boot({ title, detail }) {
  return (
    <div className="ks-boot">
      <span className="ks-boot__mark">
        <ShieldAlert size={20} strokeWidth={2.1} />
      </span>
      <strong>{title}</strong>
      {detail && <p>{detail}</p>}
    </div>
  );
}

/**
 * Gate for every signed-in route. The location is carried across so a deep
 * link such as /dashboard resumes after Google returns, instead of always
 * dropping the operator on Home.
 */
function RequireAuth({ children }) {
  const { user } = useAuth();
  const location = useLocation();

  if (!user) {
    return <Navigate to="/login" replace state={{ from: location.pathname }} />;
  }

  return children;
}

/**
 * Control room gate. A signed-in user who is not an administrator is sent to
 * Home rather than the login screen — they are authenticated, just not
 * authorised, and bouncing them to /login would look like a broken session.
 *
 * This guard is for navigation only. The backend independently verifies the
 * access token and admin membership on every alert endpoint, so typing the URL
 * or calling the API directly still returns nothing.
 */
function RequireAdmin({ children }) {
  const { user, isAdmin } = useAuth();
  const location = useLocation();

  if (!user) {
    return <Navigate to="/login" replace state={{ from: location.pathname }} />;
  }

  if (!isAdmin) {
    return (
      <Navigate
        to="/login"
        replace
        state={{ authError: "This account does not have administrator access." }}
      />
    );
  }

  return children;
}

export default function App() {
  const { status, roleReady } = useAuth();

  if (status === "unconfigured") {
    return <Boot title="Supabase is not configured" detail={configProblem} />;
  }

  // Held until getSession() answers and the admin lookup resolves. Rendering
  // sooner would flash the login screen at a signed-in operator, or bounce an
  // administrator off /dashboard before their role is known.
  if (status === "loading" || !roleReady) {
    return <Boot title="Restoring your session…" />;
  }

  return (
    <Routes>
      <Route path="/login" element={<Login />} />
      <Route path="/admin/invite/:token" element={<AdminInvitePage />} />

      <Route
        path="/"
        element={
          <RequireAuth>
            <Home />
          </RequireAuth>
        }
      />

      <Route
        path="/dashboard"
        element={
          <RequireAdmin>
            <Dashboard />
          </RequireAdmin>
        }
      />

      <Route
        path="/alerts"
        element={
          <RequireAdmin>
            <Dashboard focus="active" />
          </RequireAdmin>
        }
      />

      <Route
        path="/active-sos"
        element={
          <RequireAdmin>
            <Dashboard focus="active" />
          </RequireAdmin>
        }
      />

      <Route
        path="/admins"
        element={
          <RequireAdmin>
            <Dashboard focus="admins" />
          </RequireAdmin>
        }
      />

      <Route
        path="/history"
        element={
          <RequireAdmin>
            <Dashboard focus="history" />
          </RequireAdmin>
        }
      />

      <Route
        path="/map"
        element={
          <RequireAdmin>
            <MapGrid />
          </RequireAdmin>
        }
      />

      <Route
        path="/insights"
        element={
          <RequireAdmin>
            <Insights />
          </RequireAdmin>
        }
      />

      <Route
        path="/reports"
        element={
          <RequireAdmin>
            <Reports />
          </RequireAdmin>
        }
      />

      <Route
        path="/settings"
        element={
          <RequireAdmin>
            <Settings />
          </RequireAdmin>
        }
      />

      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
