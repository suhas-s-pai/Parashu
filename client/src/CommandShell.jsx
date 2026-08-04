import { useEffect, useState } from "react";
import { NavLink } from "react-router-dom";
import { useAuth } from "./lib/authContext";
import { pingBackend } from "./lib/api";
import {
  ShieldAlert,
  LayoutDashboard,
  Siren,
  Map,
  BarChart3,
  FileText,
  Settings,
  LogOut,
  Clock,
  Activity,
  Users,
  RefreshCw,
} from "lucide-react";

const NAV = [
  { to: "/dashboard", label: "Dashboard", icon: LayoutDashboard },
  { to: "/alerts", label: "Live Alerts", icon: Siren, counter: true },
  { to: "/map", label: "Map Grid", icon: Map },
  { to: "/insights", label: "Insights", icon: BarChart3 },
  { to: "/reports", label: "Reports", icon: FileText },
  { to: "/settings", label: "Settings", icon: Settings },
];

/**
 * Chrome shared by every control-room page: sidebar, top bar, live clock and
 * a real reachability check against the backend root route.
 */
export default function CommandShell({
  title,
  alertCount = null,
  syncLabel = "Idle",
  syncLive = false,
  children,
  wide = false,
}) {
  const { user, signOut } = useAuth();

  const [now, setNow] = useState(new Date());
  const [apiHealth, setApiHealth] = useState("checking");

  useEffect(() => {
    const tick = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(tick);
  }, []);

  useEffect(() => {
    let cancelled = false;

    const ping = async () => {
      try {
        await pingBackend();
        if (!cancelled) setApiHealth("online");
      } catch {
        if (!cancelled) setApiHealth("offline");
      }
    };

    ping();
    const timer = setInterval(ping, 30000);

    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, []);

  const healthChip =
    apiHealth === "online"
      ? { cls: "ks-dot--green", text: "Operational" }
      : apiHealth === "offline"
      ? { cls: "ks-dot--red", text: "Unreachable" }
      : { cls: "ks-dot--amber", text: "Checking" };

  return (
    <div className="ks-shell">

      <aside className="ks-sidebar">

        <a className="ks-logo" href="/">
          <span className="ks-logo__mark">
            <ShieldAlert size={16} strokeWidth={2.1} />
          </span>
          <span className="ks-logo__text">Para<span>shu</span></span>
        </a>

        <span className="ks-navgroup">Operations</span>

        <nav className="ks-nav">
          {NAV.map((item) => (
            <NavLink
              key={item.label}
              to={item.to}
              className={({ isActive }) =>
                `ks-nav__item${isActive ? " is-active" : ""}`
              }
              title={item.label}
            >
              <item.icon size={17} strokeWidth={1.8} />
              <span>{item.label}</span>
              {item.counter && alertCount > 0 && (
                <em className="ks-nav__count">{alertCount}</em>
              )}
            </NavLink>
          ))}
        </nav>

        <div className="ks-sidebar__foot">
          <button className="ks-nav__item" onClick={signOut} title="Logout">
            <LogOut size={17} strokeWidth={1.8} />
            <span>Logout</span>
          </button>
        </div>

      </aside>

      <div className="ks-body">

        <header className="ks-topbar">

          <h1 className="ks-topbar__title">{title}</h1>

          <div className="ks-topbar__spacer" />

          <div className="ks-metric">
            <Clock size={14} strokeWidth={1.8} />
            <div>
              <span className="ks-metric__label">Local time</span>
              <div className="ks-metric__value mono">
                {now.toLocaleTimeString("en-IN", {
                  hour: "2-digit",
                  minute: "2-digit",
                  second: "2-digit",
                  hour12: false,
                })}
              </div>
            </div>
          </div>

          <div className="ks-metric ks-metric--hideable">
            <Activity size={14} strokeWidth={1.8} />
            <div>
              <span className="ks-metric__label">System health</span>
              <div className="ks-metric__value">
                <span className={`ks-dot ${healthChip.cls}`} style={{ display: "inline-block", marginRight: 6 }} />
                {healthChip.text}
              </div>
            </div>
          </div>

          <div className="ks-metric ks-metric--hideable">
            <Siren size={14} strokeWidth={1.8} />
            <div>
              <span className="ks-metric__label">Active emergencies</span>
              <div className="ks-metric__value mono">
                {alertCount === null ? "—" : alertCount}
              </div>
            </div>
          </div>

          <div className="ks-metric ks-metric--hideable">
            <Users size={14} strokeWidth={1.8} />
            <div>
              <span className="ks-metric__label">Officers online</span>
              <div className="ks-metric__value ks-pending" title="Requires an officer presence service">—</div>
            </div>
          </div>

          <div className="ks-metric ks-metric--hideable">
            <RefreshCw size={14} strokeWidth={1.8} />
            <div>
              <span className="ks-metric__label">Sync</span>
              <div className="ks-metric__value">
                <span
                  className={`ks-dot ${syncLive ? "ks-dot--green" : ""}`}
                  style={{ display: "inline-block", marginRight: 6 }}
                />
                {syncLabel}
              </div>
            </div>
          </div>

          <div className="ks-badge-police">
            <span className="ks-badge-police__shield">
              <ShieldAlert size={14} strokeWidth={2} />
            </span>
            <span className="ks-badge-police__id">
              <strong>{user?.name || "Operator"}</strong>
              <span>CONTROL ROOM</span>
            </span>
          </div>

        </header>

        <main className={`ks-main${wide ? " ks-main--wide" : ""}`}>
          {children}
        </main>

      </div>

    </div>
  );
}
