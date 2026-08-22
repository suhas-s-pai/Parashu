import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useAuth } from "./lib/authContext";
import {
  getAlertStreamUrl,
  fetchActiveAlerts,
  fetchResolvedAlerts,
  resolveAlert,
  clearResolvedHistory,
} from "./lib/api";
import {
  formatCoordinates,
  formatTime,
  googleMapsUrl,
  normalizeAlert,
  osmEmbedUrl,
  osmLinkUrl,
} from "./lib/alerts";
import { usePrefs } from "./lib/prefs";
import {
  AlertTriangle,
  BellRing,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  History,
  LogOut,
  MapPin,
  Search,
  Settings as SettingsIcon,
  ShieldAlert,
  Trash2,
  UserRound,
  X,
} from "lucide-react";

// Rounded to roughly 10 m so a stationary caller does not reload the embedded
// map on every five second location ping.
function mapKeyFor(alert) {
  if (!Number.isFinite(alert?.latitude) || !Number.isFinite(alert?.longitude)) {
    return null;
  }

  return `${alert.latitude.toFixed(4)},${alert.longitude.toFixed(4)}`;
}

function LiveMap({ alert }) {
  const key = mapKeyFor(alert);

  const src = useMemo(() => {
    if (!key) return "";
    const [lat, lon] = key.split(",").map(Number);
    return osmEmbedUrl(lat, lon);
  }, [key]);

  if (!src) {
    return (
      <div className="pa-map pa-map--empty">
        <MapPin size={18} />
        <span>Waiting for a location fix</span>
      </div>
    );
  }

  return (
    <div className="pa-map">
      <iframe title={`Live location for ${alert.user_name}`} src={src} />
    </div>
  );
}

export default function Dashboard({ focus = "active" }) {
  const { user, signOut } = useAuth();
  const [prefs, togglePref] = usePrefs();

  const [activeSection, setActiveSection] = useState(focus);
  const [activeAlerts, setActiveAlerts] = useState([]);
  const [history, setHistory] = useState([]);
  const [selectedId, setSelectedId] = useState(null);
  const [searchTerm, setSearchTerm] = useState("");
  const [statusMessage, setStatusMessage] = useState("Connecting to the alert feed");
  const [addresses, setAddresses] = useState({});
  const [clearingHistory, setClearingHistory] = useState(false);
  const [showDeleteModal, setShowDeleteModal] = useState(false);
  const [deleteSuccessMsg, setDeleteSuccessMsg] = useState("");
  const [deleteErrorMsg, setDeleteErrorMsg] = useState("");

  const handleConfirmDeleteHistory = async () => {
    setClearingHistory(true);
    setDeleteSuccessMsg("");
    setDeleteErrorMsg("");

    try {
      const result = await clearResolvedHistory();
      setHistory([]);
      setShowDeleteModal(false);
      const countText = Number.isFinite(result?.deletedCount)
        ? ` (${result.deletedCount} record${result.deletedCount === 1 ? "" : "s"} removed)`
        : "";
      setDeleteSuccessMsg(`Resolved SOS history deleted successfully${countText}.`);
      setStatusMessage("Resolved SOS history has been permanently cleared from database");
      setTimeout(() => setDeleteSuccessMsg(""), 6000);
    } catch (err) {
      const errMsg =
        err?.response?.data?.message ||
        err?.message ||
        "Could not delete resolved history from database.";
      setDeleteErrorMsg(errMsg);
      setStatusMessage(`Delete failed: ${errMsg}`);
    } finally {
      setClearingHistory(false);
    }
  };

  const knownIdsRef = useRef(new Set());
  const sirenRef = useRef(null);
  const addressRequestsRef = useRef(new Set());
  // Read through a ref so flipping the toggle does not tear down and rebuild
  // the live event stream.
  const sirenEnabledRef = useRef(prefs.sirenOnNewAlert);

  useEffect(() => {
    sirenEnabledRef.current = prefs.sirenOnNewAlert;
  }, [prefs.sirenOnNewAlert]);

  // Announce genuinely new incidents only — the feed rebroadcasts on every
  // location ping, and a siren on each one would be unusable.
  const announce = useCallback((alerts) => {
    const fresh = alerts.filter((alert) => !knownIdsRef.current.has(alert.id));
    knownIdsRef.current = new Set(alerts.map((alert) => alert.id));

    if (!fresh.length) return;

    setStatusMessage(
      fresh.length === 1
        ? `New emergency from ${fresh[0].user_name}`
        : `${fresh.length} new emergencies received`
    );

    if (sirenEnabledRef.current && sirenRef.current) {
      sirenRef.current.currentTime = 0;
      // Browsers reject autoplay until the operator has interacted with the
      // page. Nothing else depends on the sound, so the failure is ignored.
      sirenRef.current.play().catch(() => {});
    }
  }, []);

  const loadHistory = useCallback(async () => {
    try {
      const resolved = await fetchResolvedAlerts();
      setHistory(resolved.map(normalizeAlert));
    } catch {
      // The history panel shows its empty state; the live feed is unaffected.
    }
  }, []);

  useEffect(() => {
    sirenRef.current = new Audio("/siren.mp3");
    sirenRef.current.preload = "auto";
  }, []);

  useEffect(() => {
    let cancelled = false;

    const load = async () => {
      try {
        const alerts = (await fetchActiveAlerts()).map(normalizeAlert);
        if (cancelled) return;
        setActiveAlerts(alerts);
        knownIdsRef.current = new Set(alerts.map((alert) => alert.id));
        setStatusMessage("Listening for active emergencies");
      } catch {
        if (!cancelled) setStatusMessage("Unable to reach the backend right now");
      }

      if (!cancelled) await loadHistory();
    };

    load();

    return () => {
      cancelled = true;
    };
  }, [loadHistory]);

  useEffect(() => {
    if (!prefs.realtime) {
      return undefined;
    }

    let source = null;
    let closed = false;

    const apply = (event, isUpdate) => {
      const payload = JSON.parse(event.data);
      const alerts = (payload.alerts || []).map(normalizeAlert);
      setActiveAlerts(alerts);

      if (isUpdate) {
        announce(alerts);
      } else {
        knownIdsRef.current = new Set(alerts.map((alert) => alert.id));
        setStatusMessage("Realtime connected");
      }
    };

    // The stream is admin only, so its URL carries the access token and has to
    // be built asynchronously — EventSource cannot send an auth header.
    const connect = async () => {
      const url = await getAlertStreamUrl();
      if (closed) return;

      source = new EventSource(url);
      source.addEventListener("snapshot", (event) => apply(event, false));
      source.addEventListener("update", (event) => apply(event, true));
      source.onerror = () => {
        setStatusMessage("Realtime interrupted. Showing the latest known data.");
      };
    };

    connect();

    return () => {
      closed = true;
      source?.close();
    };
  }, [announce, prefs.realtime]);

  const selected = useMemo(
    () => activeAlerts.find((alert) => alert.id === selectedId) || null,
    [activeAlerts, selectedId]
  );

  // One reverse geocode per incident. Nominatim asks for at most one request
  // per second, so the moving position is not re-resolved on every ping.
  useEffect(() => {
    if (!selected || addressRequestsRef.current.has(selected.id)) return;
    if (!Number.isFinite(selected.latitude) || !Number.isFinite(selected.longitude)) return;

    addressRequestsRef.current.add(selected.id);
    const { id, latitude, longitude } = selected;

    fetch(
      `https://nominatim.openstreetmap.org/reverse?format=jsonv2&lat=${latitude}&lon=${longitude}`
    )
      .then((response) => response.json())
      .then((data) => {
        setAddresses((prev) => ({
          ...prev,
          [id]: data?.display_name || "Address unavailable",
        }));
      })
      .catch(() => {
        setAddresses((prev) => ({ ...prev, [id]: "Address unavailable" }));
      });
  }, [selected]);

  const handleResolve = async (alert) => {
    try {
      await resolveAlert(alert.id);
      setActiveAlerts((prev) => prev.filter((item) => item.id !== alert.id));
      knownIdsRef.current.delete(alert.id);
      setSelectedId(null);
      setStatusMessage(`${alert.user_name}'s emergency was marked resolved`);
      loadHistory();
    } catch {
      setStatusMessage("Unable to resolve the alert right now");
    }
  };

  const filteredHistory = history.filter((item) => {
    const term = searchTerm.trim().toLowerCase();
    if (!term) return true;
    return `${item.user_name} ${item.phone}`.toLowerCase().includes(term);
  });

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
              <p>Incoming SOS alerts appear here the moment they are raised.</p>
            </div>
          )}

          {activeAlerts.map((alert) => {
            const isExpanded = selectedId === alert.id;
            const address = addresses[alert.id];

            return (
              <article
                key={alert.id}
                className={`pa-alert-card pa-alert-card--pending${isExpanded ? " is-expanded" : ""}`}
              >
                <button
                  type="button"
                  className="pa-alert-card__trigger"
                  onClick={() =>
                    setSelectedId((current) => (current === alert.id ? null : alert.id))
                  }
                  aria-expanded={isExpanded}
                >
                  <div className="pa-alert-card__top">
                    <div className="pa-avatar">
                      {alert.user_name.charAt(0).toUpperCase()}
                    </div>
                    <div className="pa-alert-card__meta">
                      <strong>{alert.user_name}</strong>
                      <span>{alert.phone} · {alert.email}</span>
                    </div>
                    <span className="pa-pill pa-pill--pending-status">
                      PENDING - ACTION REQUIRED
                    </span>
                    <span className="pa-pill">{alert.trigger_type}</span>
                    <span
                      className="pa-chevron-btn"
                      title={isExpanded ? "Collapse details" : "Expand details"}
                    >
                      {isExpanded ? <ChevronUp size={18} /> : <ChevronDown size={18} />}
                    </span>
                  </div>

                  <div className="pa-status-row">
                    <span className="pa-pill">{formatTime(alert.created_at)}</span>
                    <span className="pa-pill">{formatCoordinates(alert)}</span>
                    <span className="pa-live-dot pa-live-dot--pulse">
                      <span /> ACTIVE / PENDING
                    </span>
                  </div>
                </button>

                {isExpanded && (
                  <div className="pa-alert-expansion">
                    <LiveMap alert={alert} />

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
                        <span>Trigger type</span>
                        <strong>{alert.trigger_type}</strong>
                      </div>
                      <div className="pa-expansion-field">
                        <span>Time triggered</span>
                        <strong>{formatTime(alert.created_at)}</strong>
                      </div>
                      <div className="pa-expansion-field">
                        <span>Last location ping</span>
                        <strong>{formatTime(alert.updated_at || alert.created_at)}</strong>
                      </div>
                      <div className="pa-expansion-field">
                        <span>Coordinates</span>
                        <strong>{formatCoordinates(alert)}</strong>
                      </div>
                      <div className="pa-expansion-field">
                        <span>Status</span>
                        <strong>ACTIVE / PENDING</strong>
                      </div>
                      <div className="pa-expansion-field">
                        <span>Account</span>
                        <strong>{alert.user_id ? "Signed in" : "Unlinked"}</strong>
                      </div>
                      <div className="pa-expansion-field">
                        <span>User ID</span>
                        <strong className="pa-mono">{alert.user_id || "—"}</strong>
                      </div>
                      <div className="pa-expansion-field pa-address">
                        <span>Current address</span>
                        <strong>{address || "Resolving address…"}</strong>
                      </div>
                    </div>

                    <div className="pa-actions">
                      <a
                        className="pa-btn"
                        href={osmLinkUrl(alert.latitude, alert.longitude)}
                        target="_blank"
                        rel="noreferrer"
                      >
                        <MapPin size={14} /> Open in OpenStreetMap
                      </a>
                      <a
                        className="pa-btn pa-btn--ghost"
                        href={googleMapsUrl(alert.latitude, alert.longitude)}
                        target="_blank"
                        rel="noreferrer"
                      >
                        <MapPin size={14} /> Open in Google Maps
                      </a>
                      <button
                        type="button"
                        className="pa-btn pa-btn--success"
                        onClick={(event) => {
                          event.stopPropagation();
                          handleResolve(alert);
                        }}
                      >
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
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <button
            type="button"
            className="pa-btn pa-btn--danger"
            disabled={history.length === 0 || clearingHistory}
            onClick={() => setShowDeleteModal(true)}
            title={history.length === 0 ? "No history to delete" : "Delete all resolved history"}
          >
            <Trash2 size={14} />
            <span>{clearingHistory ? "Deleting…" : "Delete History"}</span>
          </button>
          <label className="pa-search">
            <Search size={14} />
            <input
              value={searchTerm}
              onChange={(event) => setSearchTerm(event.target.value)}
              placeholder="Search by name or phone"
            />
          </label>
        </div>
      </div>

      {deleteSuccessMsg && (
        <div style={{ margin: "12px 0 0", padding: "10px 14px", borderRadius: 8, background: "rgba(34, 197, 94, 0.12)", border: "1px solid rgba(34, 197, 94, 0.3)", color: "#4ade80", fontSize: 13, display: "flex", alignItems: "center", gap: 8 }}>
          <CheckCircle2 size={16} />
          {deleteSuccessMsg}
        </div>
      )}

      <div className="pa-history-list">
        {filteredHistory.length === 0 && (
          <div className="pa-empty-card">
            <History size={20} />
            <h3>No resolved cases</h3>
            <p>{history.length === 0 ? "No history to delete. Resolved emergencies will appear here." : "No matching historical alerts found."}</p>
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
            <strong>Signed in as</strong>
            <p>{user?.email}</p>
          </div>
          <span className="pa-pill">{user?.name}</span>
        </div>

        <div className="pa-setting-row">
          <div>
            <strong>Siren on new alert</strong>
            <p>Plays a tone when a new emergency arrives.</p>
          </div>
          <button
            className={`pa-toggle${prefs.sirenOnNewAlert ? " is-on" : ""}`}
            onClick={() => togglePref("sirenOnNewAlert")}
            aria-label="Siren on new alert"
          >
            <span />
          </button>
        </div>

        <div className="pa-setting-row">
          <div>
            <strong>Realtime feed</strong>
            <p>Stay connected to the live alert stream.</p>
          </div>
          <button
            className={`pa-toggle${prefs.realtime ? " is-on" : ""}`}
            onClick={() => togglePref("realtime")}
            aria-label="Realtime feed"
          >
            <span />
          </button>
        </div>

        <div className="pa-setting-row pa-setting-row--last">
          <div>
            <strong>Logout</strong>
            <p>Exit the control room.</p>
          </div>
          <button className="pa-btn pa-btn--ghost" onClick={signOut}>
            <LogOut size={14} /> Logout
          </button>
        </div>
      </div>
    </section>
  );

  const NAV = [
    { key: "active", label: "Active SOS", icon: AlertTriangle },
    { key: "history", label: "History", icon: History },
    { key: "settings", label: "Settings", icon: SettingsIcon },
  ];

  const heading = NAV.find((item) => item.key === activeSection)?.label || "Active SOS";

  return (
    <div className="pa-shell">
      <aside className="pa-sidebar">
        <div className="pa-brand">
          <div className="pa-brand__mark">
            <ShieldAlert size={18} />
          </div>
          <div>
            <strong>Parashu</strong>
            <span>Control Room</span>
          </div>
        </div>

        <nav className="pa-nav">
          {NAV.map((item) => {
            const Icon = item.icon;
            return (
              <button
                key={item.key}
                className={`pa-nav-item${activeSection === item.key ? " is-active" : ""}`}
                onClick={() => setActiveSection(item.key)}
              >
                <Icon size={16} />
                <span>{item.label}</span>
                {item.key === "active" && activeAlerts.length > 0 && (
                  <span className="pa-pill pa-pill--danger">{activeAlerts.length}</span>
                )}
              </button>
            );
          })}
        </nav>

        <div className="pa-sidebar-footer">
          <div className="pa-user-pill">
            <div className="pa-avatar pa-avatar--sm"><UserRound size={14} /></div>
            <div>
              <strong>{user?.name || "Operator"}</strong>
              <span>{user?.email || "Control room"}</span>
            </div>
          </div>
          <button className="pa-btn pa-btn--ghost pa-btn--full" onClick={signOut}>
            <LogOut size={14} /> Logout
          </button>
        </div>
      </aside>

      <main className="pa-main">
        <header className="pa-topbar">
          <div>
            <p className="pa-kicker">Parashu command center</p>
            <h1>{heading}</h1>
          </div>
          <div className="pa-topbar__meta">
            <span className="pa-pill pa-pill--neutral">
              <BellRing size={14} />{" "}
              {prefs.realtime ? statusMessage : "Realtime paused"}
            </span>
            <span className="pa-pill">
              <AlertTriangle size={14} /> {activeAlerts.length} active
            </span>
          </div>
        </header>

        {activeSection === "active" && renderActiveView()}
        {activeSection === "history" && renderHistoryView()}
        {activeSection === "settings" && renderSettingsView()}
      </main>

      {showDeleteModal && (
        <div className="ks-modal-overlay" onMouseDown={() => setShowDeleteModal(false)}>
          <div
            className="ks-modal"
            role="dialog"
            aria-modal="true"
            aria-label="Confirm delete history"
            onMouseDown={(event) => event.stopPropagation()}
          >
            <div className="ks-modal__head">
              <span className="ks-modal__icon" style={{ background: "rgba(239, 68, 68, 0.15)", color: "#ef4444" }}>
                <Trash2 size={16} strokeWidth={2} />
              </span>
              <h2>Delete Resolved History</h2>
              <button
                type="button"
                className="ks-modal__close"
                onClick={() => setShowDeleteModal(false)}
                aria-label="Close"
              >
                <X size={16} strokeWidth={2} />
              </button>
            </div>

            <div className="ks-modal__body">
              <p style={{ margin: 0, fontSize: 13.5, color: "var(--text)" }}>
                Delete all resolved SOS history? This action cannot be undone.
              </p>
              <p style={{ margin: 0, fontSize: 12, color: "var(--muted)" }}>
                Active SOS alerts and user accounts will not be affected.
              </p>
              {deleteErrorMsg && (
                <p style={{ margin: "6px 0 0", fontSize: 12.5, color: "#fca5a5", background: "rgba(220,38,38,0.15)", padding: "8px 10px", borderRadius: 6, border: "1px solid rgba(220,38,38,0.3)" }}>
                  Error: {deleteErrorMsg}
                </p>
              )}
            </div>

            <div className="ks-modal__foot">
              <button
                type="button"
                className="ks-btn ks-btn--ghost"
                onClick={() => setShowDeleteModal(false)}
                disabled={clearingHistory}
              >
                Cancel
              </button>
              <button
                type="button"
                className="ks-btn ks-btn--danger"
                onClick={handleConfirmDeleteHistory}
                disabled={clearingHistory}
              >
                {clearingHistory ? "Deleting…" : "Confirm Delete"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
