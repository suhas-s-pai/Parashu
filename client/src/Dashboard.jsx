import { useEffect, useState } from "react";
import axios from "axios";
import { signOutUser } from "./lib/supabaseClient";
import {
  AlertTriangle,
  BellRing,
  CheckCircle2,
  Clock3,
  History,
  LogOut,
  Mail,
  MapPin,
  Phone,
  Search,
  Settings as SettingsIcon,
  ShieldAlert,
  Sparkles,
  UserRound,
} from "lucide-react";

const API_BASE = import.meta.env.VITE_API_BASE || "https://kalisos-backend.onrender.com";

function normalizeAlert(alert) {
  return {
    ...alert,
    user_name: alert.user_name || alert.name || "Unknown",
    email: alert.email || "Not provided",
    trigger_type: alert.trigger_type || "Manual SOS",
    current_status: alert.status === "handled" ? "Resolved" : "Active",
    accuracy: alert.accuracy || alert.device_accuracy || "Unknown",
  };
}

function formatTime(isoString) {
  const date = new Date(isoString);
  return date.toLocaleString("en-IN", {
    day: "2-digit",
    month: "short",
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  });
}

export default function Dashboard() {
  const user = JSON.parse(localStorage.getItem("user") || "null");
  const [activeSection, setActiveSection] = useState("active");
  const [activeAlerts, setActiveAlerts] = useState([]);
  const [history, setHistory] = useState([]);
  const [expandedAlertId, setExpandedAlertId] = useState(null);
  const [searchTerm, setSearchTerm] = useState("");
  const [realtimeEnabled, setRealtimeEnabled] = useState(true);
  const [notificationsEnabled, setNotificationsEnabled] = useState(true);
  const [statusMessage, setStatusMessage] = useState("Listening for active emergencies");
  const [addressMap, setAddressMap] = useState({});
  const [addressLoadingMap, setAddressLoadingMap] = useState({});

  const loadAlerts = async () => {
    try {
      const res = await axios.get(`${API_BASE}/alerts`);
      const normalized = (res.data || []).map(normalizeAlert);
      setActiveAlerts(normalized);
    } catch {
      setStatusMessage("Unable to reach the backend right now");
    }
  };

  useEffect(() => {
    loadAlerts();
  }, []);

  useEffect(() => {
    if (!realtimeEnabled) {
      return undefined;
    }

    const source = new EventSource(`${API_BASE}/alerts/stream`);

    source.addEventListener("snapshot", (event) => {
      const payload = JSON.parse(event.data);
      const normalized = (payload.alerts || []).map(normalizeAlert);
      setActiveAlerts(normalized);
      setStatusMessage("Realtime connected");
    });

    source.addEventListener("update", (event) => {
      const payload = JSON.parse(event.data);
      const normalized = (payload.alerts || []).map(normalizeAlert);
      setActiveAlerts(normalized);
      if (notificationsEnabled) {
        setStatusMessage("New emergency received");
      }
    });

    source.onerror = () => {
      setStatusMessage("Realtime interrupted. Using the latest available data.");
    };

    return () => source.close();
  }, [realtimeEnabled, notificationsEnabled]);

  useEffect(() => {
    if (!expandedAlertId) {
      return;
    }

    const alert = activeAlerts.find((item) => item.id === expandedAlertId);
    if (!alert || addressMap[expandedAlertId] || addressLoadingMap[expandedAlertId]) {
      return;
    }

    const resolveAddress = async () => {
      setAddressLoadingMap((prev) => ({ ...prev, [expandedAlertId]: true }));
      try {
        const response = await fetch(
          `https://nominatim.openstreetmap.org/reverse?format=jsonv2&lat=${encodeURIComponent(alert.latitude)}&lon=${encodeURIComponent(alert.longitude)}`
        );
        const data = await response.json();
        const address = data?.display_name || "Address unavailable";
        setAddressMap((prev) => ({ ...prev, [expandedAlertId]: address }));
      } catch {
        setAddressMap((prev) => ({ ...prev, [expandedAlertId]: "Address unavailable" }));
      } finally {
        setAddressLoadingMap((prev) => ({ ...prev, [expandedAlertId]: false }));
      }
    };

    resolveAddress();
  }, [activeAlerts, addressLoadingMap, addressMap, expandedAlertId]);

  const handleResolve = async (alert) => {
    try {
      await axios.delete(`${API_BASE}/alerts/${alert.id}`);
      const resolvedAlert = normalizeAlert({ ...alert, status: "handled" });
      setHistory((prev) => [resolvedAlert, ...prev]);
      setActiveAlerts((prev) => prev.filter((item) => item.id !== alert.id));
      setExpandedAlertId(null);
      setActiveSection("history");
      setStatusMessage("Emergency marked as resolved");
    } catch {
      setStatusMessage("Unable to resolve the alert right now");
    }
  };

  const filteredHistory = history.filter((item) => {
    const term = searchTerm.trim().toLowerCase();
    if (!term) return true;
    const haystack = `${item.user_name || ""} ${item.phone || ""}`.toLowerCase();
    return haystack.includes(term);
  });

  const logout = async () => {
    await signOutUser();
    window.location.reload();
  };

  const toggleExpanded = (alertId) => {
    setExpandedAlertId((current) => (current === alertId ? null : alertId));
  };

  const openLocation = (alert) => {
    window.open(`https://maps.google.com/?q=${alert.latitude},${alert.longitude}`, "_blank", "noopener,noreferrer");
  };

  const openOpenStreetMap = (alert) => {
    window.open(`https://www.openstreetmap.org/?mlat=${alert.latitude}&mlon=${alert.longitude}#map=15/${alert.latitude}/${alert.longitude}`, "_blank", "noopener,noreferrer");
  };

  const renderActiveView = () => (
    <div className="pa-content-grid">
      <section className="pa-live-card">
        <div className="pa-panel-head">
          <div>
            <p className="pa-kicker">Active SOS</p>
            <h2>Live incidents</h2>
          </div>
          <span className="pa-pill">{activeAlerts.length} active</span>
        </div>

        <div className="pa-list">
          {activeAlerts.length === 0 && (
            <div className="pa-empty-card">
              <CheckCircle2 size={20} />
              <h3>No active emergencies</h3>
              <p>Incoming SOS alerts will appear instantly here.</p>
            </div>
          )}

          {activeAlerts.map((alert) => {
            const isExpanded = expandedAlertId === alert.id;
            const address = addressMap[alert.id];
            const isLoadingAddress = addressLoadingMap[alert.id];

            return (
              <article key={alert.id} className={`pa-alert-card${isExpanded ? " is-expanded" : ""}`}>
                <button className="pa-alert-card__trigger" onClick={() => toggleExpanded(alert.id)}>
                  <div className="pa-alert-card__top">
                    <div className="pa-avatar">{(alert.user_name || "U").charAt(0).toUpperCase()}</div>
                    <div className="pa-alert-card__meta">
                      <strong>{alert.user_name}</strong>
                      <span>{alert.phone}</span>
                    </div>
                    <span className="pa-pill pa-pill--danger">{alert.trigger_type}</span>
                  </div>

                  <div className="pa-status-row">
                    <span className="pa-pill">{formatTime(alert.created_at)}</span>
                    <span className="pa-pill">{alert.current_status}</span>
                    <span className="pa-live-dot">
                      <span /> Live
                    </span>
                  </div>
                </button>

                {isExpanded && (
                  <div className="pa-alert-expansion">
                    <div className="pa-expansion-grid">
                      <div className="pa-expansion-field">
                        <span>Full name</span>
                        <strong>{alert.user_name}</strong>
                      </div>
                      <div className="pa-expansion-field">
                        <span>Phone number</span>
                        <strong>{alert.phone}</strong>
                      </div>
                      <div className="pa-expansion-field">
                        <span>Email</span>
                        <strong>{alert.email}</strong>
                      </div>
                      <div className="pa-expansion-field">
                        <span>Latitude</span>
                        <strong>{alert.latitude}</strong>
                      </div>
                      <div className="pa-expansion-field">
                        <span>Longitude</span>
                        <strong>{alert.longitude}</strong>
                      </div>
                      <div className="pa-expansion-field">
                        <span>Device accuracy</span>
                        <strong>{alert.accuracy}</strong>
                      </div>
                      <div className="pa-expansion-field pa-address">
                        <span>Current address</span>
                        <strong>{isLoadingAddress ? "Resolving address…" : address || "Address unavailable"}</strong>
                      </div>
                      <div className="pa-expansion-field">
                        <span>Trigger type</span>
                        <strong>{alert.trigger_type}</strong>
                      </div>
                      <div className="pa-expansion-field">
                        <span>Time triggered</span>
                        <strong>{formatTime(alert.created_at)}</strong>
                      </div>
                      <div className="pa-expansion-field">
                        <span>Status</span>
                        <strong>{alert.current_status}</strong>
                      </div>
                    </div>

                    <div className="pa-actions">
                      <button className="pa-btn" onClick={(event) => {
                        event.stopPropagation();
                        openLocation(alert);
                      }}>
                        <MapPin size={14} /> Track Live
                      </button>
                      <a className="pa-btn" href={`https://maps.google.com/?q=${alert.latitude},${alert.longitude}`} target="_blank" rel="noreferrer">
                        <MapPin size={14} /> Open in Google Maps
                      </a>
                      <a className="pa-btn pa-btn--ghost" href={`https://www.openstreetmap.org/?mlat=${alert.latitude}&mlon=${alert.longitude}#map=15/${alert.latitude}/${alert.longitude}`} target="_blank" rel="noreferrer">
                        <MapPin size={14} /> Open in OpenStreetMap
                      </a>
                      <button className="pa-btn pa-btn--success" onClick={(event) => {
                        event.stopPropagation();
                        handleResolve(alert);
                      }}>
                        <CheckCircle2 size={14} /> Mark as Resolved
                      </button>
                    </div>
                  </div>
                )}
              </article>
            );
          })}
        </div>
      </section>
    </div>
  );

  const renderHistoryView = () => (
    <section className="pa-history-panel">
      <div className="pa-panel-head">
        <div>
          <p className="pa-kicker">History</p>
          <h2>Resolved incidents</h2>
        </div>
        <label className="pa-search">
          <Search size={14} />
          <input value={searchTerm} onChange={(event) => setSearchTerm(event.target.value)} placeholder="Search by name or phone" />
        </label>
      </div>

      <div className="pa-history-list">
        {filteredHistory.length === 0 && (
          <div className="pa-empty-card">
            <History size={20} />
            <h3>No resolved cases yet</h3>
            <p>Resolved emergencies will move here automatically.</p>
          </div>
        )}

        {filteredHistory.map((item) => (
          <article key={item.id} className="pa-history-card">
            <div>
              <strong>{item.user_name}</strong>
              <p>{item.phone}</p>
            </div>
            <div>
              <span>{formatTime(item.created_at)}</span>
              <small>{item.trigger_type}</small>
            </div>
            <span className="pa-pill pa-pill--success">Resolved</span>
          </article>
        ))}
      </div>
    </section>
  );

  const renderSettingsView = () => (
    <section className="pa-settings-panel">
      <div className="pa-panel-head">
        <div>
          <p className="pa-kicker">Settings</p>
          <h2>Console preferences</h2>
        </div>
      </div>

      <div className="pa-settings-card">
        <div className="pa-setting-row">
          <div>
            <strong>Theme</strong>
            <p>Dark mode is currently active.</p>
          </div>
          <span className="pa-pill">Dark</span>
        </div>

        <div className="pa-setting-row">
          <div>
            <strong>Notification sound</strong>
            <p>Play a short tone for new alerts.</p>
          </div>
          <button className={`pa-toggle${notificationsEnabled ? " is-on" : ""}`} onClick={() => setNotificationsEnabled((value) => !value)}>
            <span />
          </button>
        </div>

        <div className="pa-setting-row">
          <div>
            <strong>Realtime toggle</strong>
            <p>Connect to the live stream automatically.</p>
          </div>
          <button className={`pa-toggle${realtimeEnabled ? " is-on" : ""}`} onClick={() => setRealtimeEnabled((value) => !value)}>
            <span />
          </button>
        </div>

        <div className="pa-setting-row pa-setting-row--last">
          <div>
            <strong>Logout</strong>
            <p>Exit the control room.</p>
          </div>
          <button className="pa-btn pa-btn--ghost" onClick={logout}>
            <LogOut size={14} /> Logout
          </button>
        </div>
      </div>
    </section>
  );

  return (
    <div className="pa-shell">
      <aside className="pa-sidebar">
        <div className="pa-brand">
          <div className="pa-brand__mark">
            <ShieldAlert size={18} />
          </div>
          <div>
            <strong>Parashu</strong>
            <span>Admin Console</span>
          </div>
        </div>

        <nav className="pa-nav">
          {[
            { key: "active", label: "Active SOS", icon: AlertTriangle },
            { key: "history", label: "History", icon: History },
            { key: "settings", label: "Settings", icon: SettingsIcon },
          ].map((item) => {
            const Icon = item.icon;
            return (
              <button
                key={item.key}
                className={`pa-nav-item${activeSection === item.key ? " is-active" : ""}`}
                onClick={() => setActiveSection(item.key)}
              >
                <Icon size={16} />
                <span>{item.label}</span>
              </button>
            );
          })}
        </nav>

        <div className="pa-sidebar-footer">
          <div className="pa-user-pill">
            <div className="pa-avatar pa-avatar--sm"><UserRound size={14} /></div>
            <div>
              <strong>{user?.name || "Admin"}</strong>
              <span>{user?.phone || "Operator"}</span>
            </div>
          </div>
          <button className="pa-btn pa-btn--ghost pa-btn--full" onClick={logout}>
            <LogOut size={14} /> Logout
          </button>
        </div>
      </aside>

      <main className="pa-main">
        <header className="pa-topbar">
          <div>
            <p className="pa-kicker">Parashu command center</p>
            <h1>{activeSection === "active" ? "Active SOS" : activeSection === "history" ? "History" : "Settings"}</h1>
          </div>
          <div className="pa-topbar__meta">
            <span className="pa-pill pa-pill--neutral"><BellRing size={14} /> {statusMessage}</span>
            <span className="pa-pill"><Sparkles size={14} /> Minimal mode</span>
          </div>
        </header>

        {activeSection === "active" && renderActiveView()}
        {activeSection === "history" && renderHistoryView()}
        {activeSection === "settings" && renderSettingsView()}
      </main>
    </div>
  );
}
