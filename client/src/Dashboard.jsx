import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import QRCode from "qrcode";
import { useAuth } from "./lib/authContext";
import {
  getAlertStreamUrl,
  fetchActiveAlerts,
  fetchResolvedAlerts,
  resolveAlert,
  clearResolvedHistory,
  fetchAdmins,
  deleteAdmin,
  generateAdminInvitation,
  fetchAdminRequests,
  approveAdminRequest,
  rejectAdminRequest,
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
  Check,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  Clock,
  Copy,
  History,
  LogOut,
  MapPin,
  Menu,
  Plus,
  QrCode,
  RotateCcw,
  Search,
  Settings as SettingsIcon,
  Share2,
  ShieldAlert,
  ShieldCheck,
  Trash2,
  UserPlus,
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

  const [admins, setAdmins] = useState([]);
  const [adminRequests, setAdminRequests] = useState([]);
  const [showInviteModal, setShowInviteModal] = useState(false);
  const [showRemoveAdminModal, setShowRemoveAdminModal] = useState(false);
  const [targetAdmin, setTargetAdmin] = useState(null);

  // QR Code invitation state
  const [currentInvitation, setCurrentInvitation] = useState(null);
  const [qrDataUrl, setQrDataUrl] = useState("");
  const [timeLeftSeconds, setTimeLeftSeconds] = useState(300);
  const [generatingInvite, setGeneratingInvite] = useState(false);
  const [shareToast, setShareToast] = useState("");

  const [removeAdminError, setRemoveAdminError] = useState("");
  const [removingAdmin, setRemovingAdmin] = useState(false);
  const [adminMsg, setAdminMsg] = useState("");
  const [sidebarOpen, setSidebarOpen] = useState(false);

  const loadAdmins = useCallback(async () => {
    try {
      const list = await fetchAdmins();
      setAdmins(list);
    } catch {
      // Failed to load admins list
    }
  }, []);

  const loadAdminRequests = useCallback(async () => {
    try {
      const reqs = await fetchAdminRequests();
      setAdminRequests(reqs);
    } catch {
      // Failed to load admin requests
    }
  }, []);

  useEffect(() => {
    if (activeSection === "admins") {
      loadAdmins();
      loadAdminRequests();
    }
  }, [activeSection, loadAdmins, loadAdminRequests]);

  // Generate QR code invitation
  const handleOpenInviteModal = async () => {
    setGeneratingInvite(true);
    setShareToast("");
    setShowInviteModal(true);

    try {
      const res = await generateAdminInvitation();
      if (res?.success && res.invitation) {
        const inv = res.invitation;
        setCurrentInvitation(inv);
        const inviteUrl = `${window.location.origin}/admin/invite/${inv.token}`;

        const dataUrl = await QRCode.toDataURL(inviteUrl, {
          width: 260,
          margin: 2,
          color: {
            dark: "#0f172a",
            light: "#ffffff",
          },
        });
        setQrDataUrl(dataUrl);

        const remaining = Math.max(0, Math.floor((inv.expires_at - Date.now()) / 1000));
        setTimeLeftSeconds(remaining || 300);
      }
    } catch {
      // Error generating invitation
    } finally {
      setGeneratingInvite(false);
    }
  };

  // Live countdown timer effect for active QR code modal
  useEffect(() => {
    if (!showInviteModal || !currentInvitation || timeLeftSeconds <= 0) return;

    const timer = setInterval(() => {
      setTimeLeftSeconds((prev) => {
        if (prev <= 1) {
          clearInterval(timer);
          return 0;
        }
        return prev - 1;
      });
    }, 1000);

    return () => clearInterval(timer);
  }, [showInviteModal, currentInvitation, timeLeftSeconds]);

  // Share invitation button handler
  const handleShareInvitation = async () => {
    if (!currentInvitation) return;
    const inviteUrl = `${window.location.origin}/admin/invite/${currentInvitation.token}`;
    const shareMessage = `You're invited to become an administrator of Parashu. Open this invitation to request admin access: ${inviteUrl}`;

    if (navigator.share) {
      try {
        await navigator.share({
          title: "Parashu Administrator Invitation",
          text: shareMessage,
          url: inviteUrl,
        });
        return;
      } catch {
        // Fallback to clipboard if share was cancelled or failed
      }
    }

    try {
      await navigator.clipboard.writeText(inviteUrl);
      setShareToast("Invitation link copied!");
      setTimeout(() => setShareToast(""), 4000);
    } catch {
      setShareToast("Copy failed. Link: " + inviteUrl);
    }
  };

  // Approve Admin Request
  const handleApproveRequest = async (reqId) => {
    try {
      const res = await approveAdminRequest(reqId);
      if (res?.success) {
        setAdminMsg(res.message || "Administrator request approved.");
        setTimeout(() => setAdminMsg(""), 6000);
        loadAdmins();
        loadAdminRequests();
      }
    } catch (err) {
      setAdminMsg(err?.response?.data?.message || err?.message || "Could not approve admin request.");
      setTimeout(() => setAdminMsg(""), 6000);
    }
  };

  // Reject Admin Request
  const handleRejectRequest = async (reqId) => {
    try {
      const res = await rejectAdminRequest(reqId);
      if (res?.success) {
        setAdminMsg(res.message || "Administrator request rejected.");
        setTimeout(() => setAdminMsg(""), 6000);
        loadAdminRequests();
      }
    } catch (err) {
      setAdminMsg(err?.response?.data?.message || err?.message || "Could not reject admin request.");
      setTimeout(() => setAdminMsg(""), 6000);
    }
  };

  const handleConfirmRemoveAdmin = async () => {
    if (!targetAdmin) return;
    setRemovingAdmin(true);
    setRemoveAdminError("");

    try {
      await deleteAdmin(targetAdmin.user_id);
      setShowRemoveAdminModal(false);
      setTargetAdmin(null);
      setAdminMsg("Administrator removed successfully.");
      setTimeout(() => setAdminMsg(""), 6000);
      loadAdmins();
    } catch (err) {
      setRemoveAdminError(
        err?.response?.data?.message ||
          err?.message ||
          "Could not remove administrator."
      );
    } finally {
      setRemovingAdmin(false);
    }
  };

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
  const initialLoadCompleteRef = useRef(false);
  const sirenRef = useRef(null);
  const sirenTimeoutRef = useRef(null);
  const addressRequestsRef = useRef(new Set());
  // Read through a ref so flipping the toggle does not tear down and rebuild
  // the live event stream.
  const sirenEnabledRef = useRef(prefs.sirenOnNewAlert);

  useEffect(() => {
    sirenEnabledRef.current = prefs.sirenOnNewAlert;
  }, [prefs.sirenOnNewAlert]);

  // Plays siren sound strictly for 4 seconds, then pauses and resets audio
  const playSiren4Seconds = useCallback(() => {
    if (!sirenEnabledRef.current || !sirenRef.current) return;

    if (sirenTimeoutRef.current) {
      clearTimeout(sirenTimeoutRef.current);
      sirenTimeoutRef.current = null;
    }

    try {
      sirenRef.current.currentTime = 0;
      const playPromise = sirenRef.current.play();
      if (playPromise !== undefined) {
        playPromise.catch(() => {});
      }
    } catch {
      // Ignore browser autoplay restriction errors
    }

    sirenTimeoutRef.current = setTimeout(() => {
      if (sirenRef.current) {
        try {
          sirenRef.current.pause();
          sirenRef.current.currentTime = 0;
        } catch {
          // Ignore
        }
      }
      sirenTimeoutRef.current = null;
    }, 4000);
  }, []);

  // Announce genuinely new incidents only — strictly play 4s siren on NEW reports
  const announce = useCallback((alerts) => {
    const fresh = alerts.filter((alert) => !knownIdsRef.current.has(alert.id));
    knownIdsRef.current = new Set(alerts.map((alert) => alert.id));

    // If initial load snapshot hasn't finished, mark complete and DO NOT play siren for old records
    if (!initialLoadCompleteRef.current) {
      initialLoadCompleteRef.current = true;
      return;
    }

    if (!fresh.length) return;

    setStatusMessage(
      fresh.length === 1
        ? `New emergency from ${fresh[0].user_name}`
        : `${fresh.length} new emergencies received`
    );

    playSiren4Seconds();
  }, [playSiren4Seconds]);

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

    return () => {
      if (sirenTimeoutRef.current) {
        clearTimeout(sirenTimeoutRef.current);
        sirenTimeoutRef.current = null;
      }
      if (sirenRef.current) {
        try {
          sirenRef.current.pause();
          sirenRef.current.currentTime = 0;
        } catch {
          // Ignore
        }
      }
    };
  }, []);

  useEffect(() => {
    let cancelled = false;

    const load = async () => {
      try {
        const alerts = (await fetchActiveAlerts()).map(normalizeAlert);
        if (cancelled) return;
        setActiveAlerts(alerts);
        knownIdsRef.current = new Set(alerts.map((alert) => alert.id));
        initialLoadCompleteRef.current = true;
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

  const renderAdminsView = () => (
    <section className="pa-history-panel">
      <div className="pa-panel-head">
        <div>
          <p className="pa-kicker">Access Control</p>
          <h2>Administrator Management</h2>
        </div>
        <button
          type="button"
          className="pa-btn pa-btn--danger"
          onClick={handleOpenInviteModal}
        >
          <QrCode size={16} />
          <span>Add New Admin</span>
        </button>
      </div>

      {adminMsg && (
        <div style={{ margin: "12px 0 0", padding: "10px 14px", borderRadius: 8, background: "rgba(34, 197, 94, 0.12)", border: "1px solid rgba(34, 197, 94, 0.3)", color: "#4ade80", fontSize: 13, display: "flex", alignItems: "center", gap: 8 }}>
          <CheckCircle2 size={16} />
          {adminMsg}
        </div>
      )}

      {/* Pending Admin Requests Section */}
      {adminRequests.length > 0 && (
        <div style={{ marginTop: 20 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 12 }}>
            <Clock size={16} style={{ color: "#facc15" }} />
            <h3 style={{ margin: 0, fontSize: 15, fontWeight: 700 }}>Pending Admin Requests ({adminRequests.length})</h3>
          </div>
          <div className="pa-history-list">
            {adminRequests.map((req) => (
              <article key={req.id} className="pa-history-card pa-admin-card" style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, borderLeft: "3px solid #facc15", flexWrap: "wrap" }}>
                <div style={{ display: "flex", alignItems: "center", gap: 12, minWidth: 200 }}>
                  <div className="pa-avatar" style={{ width: 40, height: 40, fontSize: 15, background: "linear-gradient(135deg, #d97706, #b45309)" }}>
                    {req.name.charAt(0).toUpperCase()}
                  </div>
                  <div>
                    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                      <strong style={{ fontSize: 14 }}>{req.name}</strong>
                      <span className="pa-pill" style={{ background: "rgba(234, 179, 8, 0.16)", color: "#fde047", border: "1px solid rgba(234, 179, 8, 0.3)", fontSize: 10 }}>PENDING APPROVAL</span>
                    </div>
                    <p style={{ margin: "2px 0 0", fontSize: 12, color: "var(--muted)" }}>
                      {req.email} · Requested {formatTime(req.created_at)}
                    </p>
                  </div>
                </div>

                <div style={{ display: "flex", alignItems: "center", gap: 8, marginLeft: "auto" }}>
                  <button
                    type="button"
                    className="pa-btn pa-btn--success"
                    style={{ padding: "6px 12px", fontSize: 12 }}
                    onClick={() => handleApproveRequest(req.id)}
                  >
                    <Check size={14} />
                    <span>Approve</span>
                  </button>
                  <button
                    type="button"
                    className="pa-btn pa-btn--ghost"
                    style={{ color: "#fca5a5", borderColor: "rgba(239, 68, 68, 0.2)", padding: "6px 12px", fontSize: 12 }}
                    onClick={() => handleRejectRequest(req.id)}
                  >
                    <X size={14} />
                    <span>Reject</span>
                  </button>
                </div>
              </article>
            ))}
          </div>
        </div>
      )}

      {/* Existing Administrators List */}
      <div style={{ marginTop: 24 }}>
        <h3 style={{ margin: "0 0 12px", fontSize: 15, fontWeight: 700, display: "flex", alignItems: "center", gap: 8 }}>
          <ShieldCheck size={16} style={{ color: "#60a5fa" }} /> Active Administrators ({admins.length})
        </h3>
        <div className="pa-history-list">
          {admins.length === 0 && (
            <div className="pa-empty-card">
              <ShieldCheck size={20} />
              <h3>Loading administrators…</h3>
            </div>
          )}

          {admins.map((adm) => {
            const isSelf = adm.user_id === user?.id || adm.email === user?.email;

            return (
              <article key={adm.user_id} className="pa-history-card pa-admin-card" style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
                <div style={{ display: "flex", alignItems: "center", gap: 12, minWidth: 200 }}>
                  <div className="pa-avatar" style={{ width: 40, height: 40, fontSize: 15, background: isSelf ? "linear-gradient(135deg, #2563eb, #1d4ed8)" : "linear-gradient(135deg, #475569, #334155)" }}>
                    {adm.name.charAt(0).toUpperCase()}
                  </div>
                  <div>
                    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                      <strong style={{ fontSize: 14 }}>{adm.name}</strong>
                      {isSelf && <span className="pa-pill pa-pill--neutral" style={{ fontSize: 10 }}>You</span>}
                    </div>
                    <p style={{ margin: "2px 0 0", fontSize: 12, color: "var(--muted)" }}>
                      {adm.email} · ID: <span className="pa-mono" style={{ fontSize: 11 }}>{adm.user_id.slice(0, 8)}…</span>
                    </p>
                  </div>
                </div>

                <div style={{ display: "flex", alignItems: "center", gap: 12, marginLeft: "auto" }}>
                  <span className="pa-pill" style={{ fontSize: 11 }}>
                    Added {formatTime(adm.created_at)}
                  </span>
                  <button
                    type="button"
                    className="pa-btn pa-btn--ghost"
                    style={{ color: "#fca5a5", borderColor: "rgba(239, 68, 68, 0.2)" }}
                    onClick={() => {
                      setTargetAdmin(adm);
                      setRemoveAdminError("");
                      setShowRemoveAdminModal(true);
                    }}
                    title={`Remove ${adm.name}`}
                  >
                    <Trash2 size={14} />
                    <span>Remove</span>
                  </button>
                </div>
              </article>
            );
          })}
        </div>
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
    { key: "admins", label: "Admins", icon: ShieldCheck },
    { key: "settings", label: "Settings", icon: SettingsIcon },
  ];

  const heading = NAV.find((item) => item.key === activeSection)?.label || "Active SOS";

  return (
    <div className="pa-shell">
      {sidebarOpen && (
        <div className="pa-sidebar-backdrop" onClick={() => setSidebarOpen(false)} />
      )}
      <aside className={`pa-sidebar${sidebarOpen ? " is-open" : ""}`}>
        <div className="pa-brand">
          <div className="pa-brand__mark">
            <ShieldAlert size={18} />
          </div>
          <div>
            <strong>Parashu</strong>
            <span>Control Room</span>
          </div>
          <button
            type="button"
            className="pa-sidebar-close"
            onClick={() => setSidebarOpen(false)}
            aria-label="Close menu"
          >
            <X size={18} />
          </button>
        </div>

        <nav className="pa-nav">
          {NAV.map((item) => {
            const Icon = item.icon;
            return (
              <button
                key={item.key}
                className={`pa-nav-item${activeSection === item.key ? " is-active" : ""}`}
                onClick={() => {
                  setActiveSection(item.key);
                  setSidebarOpen(false);
                }}
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
          <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
            <button
              type="button"
              className="pa-mobile-menu-btn"
              onClick={() => setSidebarOpen(!sidebarOpen)}
              aria-label="Toggle navigation menu"
            >
              <Menu size={20} />
            </button>
            <div>
              <p className="pa-kicker">Parashu command center</p>
              <h1>{heading}</h1>
            </div>
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
        {activeSection === "admins" && renderAdminsView()}
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

      {/* Invite New Administrator QR Code Modal */}
      {showInviteModal && (
        <div className="ks-modal-overlay" onMouseDown={() => setShowInviteModal(false)}>
          <div
            className="ks-modal"
            style={{ maxWidth: 440 }}
            role="dialog"
            aria-modal="true"
            aria-label="Invite New Administrator"
            onMouseDown={(e) => e.stopPropagation()}
          >
            <div className="ks-modal__head">
              <span className="ks-modal__icon" style={{ background: "rgba(220, 38, 38, 0.16)", color: "#fca5a5" }}>
                <QrCode size={18} strokeWidth={2} />
              </span>
              <h2>Invite New Administrator</h2>
              <button
                type="button"
                className="ks-modal__close"
                onClick={() => setShowInviteModal(false)}
                aria-label="Close"
              >
                <X size={16} strokeWidth={2} />
              </button>
            </div>

            <div className="ks-modal__body" style={{ textAlign: "center", padding: "20px 20px" }}>
              {generatingInvite ? (
                <div style={{ padding: "40px 0", color: "var(--muted)" }}>
                  <p>Generating invitation token and QR code…</p>
                </div>
              ) : (
                <>
                  <p style={{ margin: "0 0 16px", fontSize: 13, color: "var(--muted)" }}>
                    Scan this QR code or share the invitation link with the person you want to add as an administrator.
                  </p>

                  {/* QR Code Container */}
                  <div style={{ position: "relative", display: "inline-block", background: "#ffffff", padding: 12, borderRadius: 16, boxShadow: "0 4px 20px rgba(0,0,0,0.4)" }}>
                    {qrDataUrl ? (
                      <img
                        src={qrDataUrl}
                        alt="Admin Invitation QR Code"
                        style={{ width: 220, height: 220, display: "block", filter: timeLeftSeconds === 0 ? "blur(6px) opacity(0.25)" : "none" }}
                      />
                    ) : (
                      <div style={{ width: 220, height: 220, display: "grid", placeItems: "center", color: "#64748b" }}>
                        <span>Generating QR…</span>
                      </div>
                    )}

                    {timeLeftSeconds === 0 && (
                      <div style={{ position: "absolute", inset: 0, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", background: "rgba(2, 6, 23, 0.85)", borderRadius: 16, padding: 16 }}>
                        <Clock size={28} style={{ color: "#ef4444", marginBottom: 6 }} />
                        <strong style={{ color: "#fca5a5", fontSize: 14 }}>Invitation Expired</strong>
                        <span style={{ fontSize: 11, color: "var(--muted)", marginTop: 2 }}>5-minute time limit reached</span>
                      </div>
                    )}
                  </div>

                  {/* Token & Timer */}
                  <div style={{ marginTop: 16, display: "flex", flexDirection: "column", alignItems: "center", gap: 6 }}>
                    {timeLeftSeconds > 0 ? (
                      <div style={{ display: "inline-flex", alignItems: "center", gap: 6, padding: "6px 14px", borderRadius: 20, background: "rgba(234, 179, 8, 0.14)", border: "1px solid rgba(234, 179, 8, 0.3)", color: "#fde047", fontSize: 13, fontWeight: 600 }}>
                        <Clock size={14} />
                        <span>Invitation expires in {String(Math.floor(timeLeftSeconds / 60)).padStart(2, "0")}:{String(timeLeftSeconds % 60).padStart(2, "0")}</span>
                      </div>
                    ) : (
                      <div style={{ display: "inline-flex", alignItems: "center", gap: 6, padding: "6px 14px", borderRadius: 20, background: "rgba(239, 68, 68, 0.16)", border: "1px solid rgba(239, 68, 68, 0.3)", color: "#fca5a5", fontSize: 13, fontWeight: 600 }}>
                        <Clock size={14} />
                        <span>Invitation Expired</span>
                      </div>
                    )}

                    {currentInvitation && (
                      <p style={{ margin: "4px 0 0", fontSize: 11.5, color: "var(--muted)" }}>
                        Code: <span className="pa-mono" style={{ color: "var(--text)" }}>{currentInvitation.token.slice(0, 16)}…</span>
                      </p>
                    )}
                  </div>

                  {/* Toast notification */}
                  {shareToast && (
                    <div style={{ marginTop: 12, padding: "8px 12px", borderRadius: 6, background: "rgba(34, 197, 94, 0.15)", border: "1px solid rgba(34, 197, 94, 0.3)", color: "#4ade80", fontSize: 12.5, display: "inline-flex", alignItems: "center", gap: 6 }}>
                      <Check size={14} />
                      {shareToast}
                    </div>
                  )}

                  {/* Actions */}
                  <div style={{ marginTop: 20, display: "grid", gap: 10 }}>
                    {timeLeftSeconds > 0 ? (
                      <button
                        type="button"
                        className="ks-btn ks-btn--danger"
                        style={{ width: "100%", justifyContent: "center", gap: 8 }}
                        onClick={handleShareInvitation}
                      >
                        <Share2 size={16} />
                        <span>Share Invitation Link</span>
                      </button>
                    ) : (
                      <button
                        type="button"
                        className="ks-btn ks-btn--danger"
                        style={{ width: "100%", justifyContent: "center", gap: 8 }}
                        onClick={handleOpenInviteModal}
                      >
                        <RotateCcw size={16} />
                        <span>Generate New Invitation</span>
                      </button>
                    )}

                    <button
                      type="button"
                      className="ks-btn ks-btn--ghost"
                      style={{ width: "100%", justifyContent: "center" }}
                      onClick={() => setShowInviteModal(false)}
                    >
                      Close
                    </button>
                  </div>
                </>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Remove Admin Modal */}
      {showRemoveAdminModal && targetAdmin && (
        <div className="ks-modal-overlay" onMouseDown={() => setShowRemoveAdminModal(false)}>
          <div
            className="ks-modal"
            role="dialog"
            aria-modal="true"
            aria-label="Remove Administrator"
            onMouseDown={(e) => e.stopPropagation()}
          >
            <div className="ks-modal__head">
              <span className="ks-modal__icon" style={{ background: "rgba(239, 68, 68, 0.15)", color: "#ef4444" }}>
                <Trash2 size={16} strokeWidth={2} />
              </span>
              <h2>Remove Administrator</h2>
              <button
                type="button"
                className="ks-modal__close"
                onClick={() => setShowRemoveAdminModal(false)}
                aria-label="Close"
              >
                <X size={16} strokeWidth={2} />
              </button>
            </div>

            <div className="ks-modal__body">
              <p style={{ margin: 0, fontSize: 13.5, color: "var(--text)" }}>
                Are you sure you want to remove <strong>{targetAdmin.name}</strong> ({targetAdmin.email}) as an administrator?
              </p>
              <p style={{ margin: 0, fontSize: 12, color: "var(--muted)" }}>
                This user will lose control room access immediately.
              </p>

              {removeAdminError && (
                <p style={{ margin: "6px 0 0", fontSize: 12.5, color: "#fca5a5", background: "rgba(220,38,38,0.15)", padding: "8px 10px", borderRadius: 6, border: "1px solid rgba(220,38,38,0.3)" }}>
                  Error: {removeAdminError}
                </p>
              )}
            </div>

            <div className="ks-modal__foot">
              <button
                type="button"
                className="ks-btn ks-btn--ghost"
                onClick={() => setShowRemoveAdminModal(false)}
                disabled={removingAdmin}
              >
                Cancel
              </button>
              <button
                type="button"
                className="ks-btn ks-btn--danger"
                onClick={handleConfirmRemoveAdmin}
                disabled={removingAdmin}
              >
                {removingAdmin ? "Removing…" : "Confirm Remove"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
