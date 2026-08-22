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
  fetchNearbyHospitals,
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
  QrCode,
  Search,
  Share2,
  ShieldAlert,
  ShieldCheck,
  Trash2,
  UserRound,
  Volume2,
  X,
} from "lucide-react";

// Avatar monogram for an administrator or a pending request. The name is
// preferred over the email so the tile matches the label beside it.
function initialOf(name, email) {
  const source = String(name || email || "").trim();
  return source ? source[0].toUpperCase() : "?";
}

// Supabase user ids are full UUIDs. The row only needs enough of one to tell
// two accounts apart, so it is truncated rather than wrapped.
function shortId(userId) {
  const value = String(userId || "");
  return value.length > 8 ? `${value.slice(0, 8)}…` : value || "—";
}

// The command-center header names the view rather than the product, so the
// operator can tell at a glance which console they are looking at.
const PAGE_TITLES = {
  active: "Active SOS",
  history: "History",
  admins: "Admins",
};

function getDistanceKm(lat1, lon1, lat2, lon2) {
  const R = 6371;
  const dLat = (lat2 - lat1) * (Math.PI / 180);
  const dLon = (lon2 - lon1) * (Math.PI / 180);
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(lat1 * (Math.PI / 180)) *
      Math.cos(lat2 * (Math.PI / 180)) *
      Math.sin(dLon / 2) *
      Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

// Component to fetch and display nearby emergency medical facilities / hospitals for an SOS alert
function NearbyHospitalsList({ alert }) {
  const [hospitals, setHospitals] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!alert || !Number.isFinite(alert.latitude) || !Number.isFinite(alert.longitude)) {
      return;
    }

    let isMounted = true;
    setLoading(true);
    setError("");

    const loadHospitals = async () => {
      try {
        const { latitude, longitude } = alert;
        let data = [];

        try {
          data = await fetchNearbyHospitals(latitude, longitude);
        } catch {
          // Direct fallback if backend API route is unreachable
          const query = `
            [out:json][timeout:15];
            (
              node["amenity"="hospital"](around:10000,${latitude},${longitude});
              way["amenity"="hospital"](around:10000,${latitude},${longitude});
              relation["amenity"="hospital"](around:10000,${latitude},${longitude});
              node["amenity"="clinic"](around:10000,${latitude},${longitude});
              way["amenity"="clinic"](around:10000,${latitude},${longitude});
              node["healthcare"="hospital"](around:10000,${latitude},${longitude});
            );
            out center 15;
          `;
          const res = await fetch(
            `https://overpass-api.de/api/interpreter?data=${encodeURIComponent(query)}`
          );
          if (res.ok) {
            const raw = await res.json();
            data = (raw.elements || [])
              .map((item) => {
                const latVal = item.lat ?? item.center?.lat;
                const lonVal = item.lon ?? item.center?.lon;
                if (!latVal || !lonVal) return null;
                const tags = item.tags || {};
                const dist = getDistanceKm(latitude, longitude, latVal, lonVal);
                const street = tags["addr:street"] || tags["addr:full"] || "";
                const city = tags["addr:city"] || tags["addr:suburb"] || "";
                const address =
                  [street, city].filter(Boolean).join(", ") || "Address available on map";
                const phone =
                  tags.phone || tags["contact:phone"] || tags["emergency:phone"] || null;
                return {
                  id: String(item.id || `${latVal}-${lonVal}`),
                  name: tags.name || tags["name:en"] || "Emergency Hospital",
                  address,
                  phone,
                  distanceKm: dist,
                  lat: latVal,
                  lon: lonVal,
                };
              })
              .filter(Boolean)
              .sort((a, b) => a.distanceKm - b.distanceKm)
              .slice(0, 5);
          }
        }

        if (!isMounted) return;

        setHospitals(data || []);
        if (!data || data.length === 0) {
          setError("No nearby hospitals found.");
        }
      } catch {
        if (isMounted) {
          setError("Unable to load nearby hospitals right now.");
        }
      } finally {
        if (isMounted) setLoading(false);
      }
    };

    loadHospitals();

    return () => {
      isMounted = false;
    };
  }, [alert]);

  return (
    <div className="pa-nearby-hospitals-box">
      <div className="pa-nearby-hospitals-header">
        <span className="pa-hospitals-title">🏥 Nearby Emergency Medical Facilities</span>
        <span className="pa-hospitals-subtitle">(Around SOS coordinates)</span>
      </div>

      {loading && (
        <div className="pa-hospitals-status">
          Searching nearest medical facilities around SOS location…
        </div>
      )}

      {error && !loading && (
        <div className="pa-hospitals-status pa-hospitals-error">
          {error}
        </div>
      )}

      {!loading && !error && hospitals.length > 0 && (
        <div className="pa-hospitals-list">
          {hospitals.map((hosp) => (
            <div key={hosp.id} className="pa-hospital-card">
              <div className="pa-hospital-info">
                <div className="pa-hospital-name">{hosp.name}</div>
                <div className="pa-hospital-addr">{hosp.address}</div>
                {hosp.phone && (
                  <div className="pa-hospital-phone">📞 {hosp.phone}</div>
                )}
              </div>
              <div className="pa-hospital-side">
                <span className="pa-hospital-dist">
                  {hosp.distanceKm < 1
                    ? `${Math.round(hosp.distanceKm * 1000)} m`
                    : `${hosp.distanceKm.toFixed(1)} km`}
                </span>
                <a
                  href={`https://www.google.com/maps/search/?api=1&query=${hosp.lat},${hosp.lon}`}
                  target="_blank"
                  rel="noreferrer"
                  className="pa-hospital-map-link"
                >
                  View on Map
                </a>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function LiveMap({ alert }) {
  if (!Number.isFinite(alert?.latitude) || !Number.isFinite(alert?.longitude)) {
    return (
      <div className="pa-map-card pa-map-card--empty">
        <MapPin size={18} />
        <span>No location coordinates provided with this alert</span>
      </div>
    );
  }

  return (
    <div className="pa-map-card">
      <iframe
        title={`Live position map for ${alert.user_name}`}
        src={osmEmbedUrl(alert.latitude, alert.longitude)}
        loading="lazy"
      />
    </div>
  );
}

export default function Dashboard({ focus = "active" }) {
  const { user, signOut } = useAuth();
  const { prefs, togglePref } = usePrefs();

  const [activeAlerts, setActiveAlerts] = useState([]);
  const [history, setHistory] = useState([]);
  const [addresses, setAddresses] = useState({});
  const [selectedId, setSelectedId] = useState(null);

  const [tab, setTab] = useState(focus);
  const [searchTerm, setSearchTerm] = useState("");
  const [statusMessage, setStatusMessage] = useState("Connecting to emergency stream…");

  const [admins, setAdmins] = useState([]);
  const [adminRequests, setAdminRequests] = useState([]);
  const [adminsLoading, setAdminsLoading] = useState(false);
  const [adminsError, setAdminsError] = useState("");

  const [showInviteModal, setShowInviteModal] = useState(false);
  const [, setInviteToken] = useState("");
  const [inviteUrl, setInviteUrl] = useState("");
  const [qrDataUrl, setQrDataUrl] = useState("");
  const [inviteExpiresAt, setInviteExpiresAt] = useState(null);
  const [inviteTimeLeft, setInviteTimeLeft] = useState(300);
  const [inviteLoading, setInviteLoading] = useState(false);
  const [inviteCopied, setInviteCopied] = useState(false);

  const [clearingHistory, setClearingHistory] = useState(false);
  const [showDeleteModal, setShowDeleteModal] = useState(false);
  const [deleteSuccessMsg, setDeleteSuccessMsg] = useState("");

  const announcedAlertIdsRef = useRef(new Set());
  const isInitialLoadRef = useRef(true);
  const sirenRef = useRef(null);
  const sirenTimeoutRef = useRef(null);
  const addressRequestsRef = useRef(new Set());
  const [audioBlocked, setAudioBlocked] = useState(false);

  const sirenEnabledRef = useRef(prefs.sirenOnNewAlert);

  useEffect(() => {
    sirenEnabledRef.current = prefs.sirenOnNewAlert;
  }, [prefs.sirenOnNewAlert]);

  // Plays siren sound strictly for 4 seconds, then pauses and resets audio
  const playSiren4Seconds = useCallback(() => {
    if (!sirenEnabledRef.current) return;

    if (sirenTimeoutRef.current) {
      clearTimeout(sirenTimeoutRef.current);
      sirenTimeoutRef.current = null;
    }

    if (!sirenRef.current) {
      sirenRef.current = new Audio("/siren.mp3");
      sirenRef.current.preload = "auto";
    }

    try {
      sirenRef.current.currentTime = 0;
      sirenRef.current.loop = false;
      const playPromise = sirenRef.current.play();

      if (playPromise !== undefined) {
        playPromise
          .then(() => {
            setAudioBlocked(false);
          })
          .catch((err) => {
            console.warn("Siren autoplay rejected by browser:", err);
            setAudioBlocked(true);
          });
      }
    } catch {
      setAudioBlocked(true);
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

  // Announce genuinely NEW incidents only — strictly play 4s siren on NEW real-time reports
  const announce = useCallback(
    (alerts) => {
      const unannounced = alerts.filter(
        (alert) => !announcedAlertIdsRef.current.has(alert.id)
      );

      // Register all incoming alert IDs into known set so re-renders/polls do not re-trigger
      alerts.forEach((alert) => announcedAlertIdsRef.current.add(alert.id));

      // Suppress siren on initial dashboard mount, page refresh, or stream snapshot
      if (isInitialLoadRef.current) {
        isInitialLoadRef.current = false;
        return;
      }

      if (!unannounced.length) return;

      setStatusMessage(
        unannounced.length === 1
          ? `New emergency from ${unannounced[0].user_name}`
          : `${unannounced.length} new emergencies received`
      );

      playSiren4Seconds();
    },
    [playSiren4Seconds]
  );

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
        alerts.forEach((alert) => announcedAlertIdsRef.current.add(alert.id));
        isInitialLoadRef.current = false;
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
        alerts.forEach((alert) => announcedAlertIdsRef.current.add(alert.id));
        isInitialLoadRef.current = false;
        setStatusMessage("Realtime connected");
      }
    };

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

  const loadAdminsAndRequests = useCallback(async () => {
    setAdminsLoading(true);
    setAdminsError("");
    try {
      const [adminList, requestList] = await Promise.all([
        fetchAdmins(),
        fetchAdminRequests(),
      ]);
      setAdmins(adminList);
      setAdminRequests(requestList);
    } catch {
      setAdminsError("Failed to load admin directory or requests.");
    } finally {
      setAdminsLoading(false);
    }
  }, []);

  // /alerts, /history and /admins render this same component, so a route
  // change swaps the prop instead of remounting. Without this the operator
  // would stay on whichever tab they were already looking at.
  useEffect(() => {
    setTab(focus);
  }, [focus]);

  useEffect(() => {
    if (tab === "admins") {
      loadAdminsAndRequests();
    }
  }, [tab, loadAdminsAndRequests]);

  const handleGenerateInvitation = async () => {
    setInviteLoading(true);
    setInviteCopied(false);
    try {
      const res = await generateAdminInvitation();
      if (res.success) {
        setInviteToken(res.token);
        const fullUrl = `${window.location.origin}/admin/invite/${res.token}`;
        setInviteUrl(fullUrl);
        setInviteExpiresAt(res.expiresAt);
        setInviteTimeLeft(300);

        const qr = await QRCode.toDataURL(fullUrl, {
          width: 240,
          margin: 2,
          color: { dark: "#0f172a", light: "#ffffff" },
        });
        setQrDataUrl(qr);
        setShowInviteModal(true);
      }
    } catch {
      setStatusMessage("Failed to generate admin invitation.");
    } finally {
      setInviteLoading(false);
    }
  };

  useEffect(() => {
    if (!showInviteModal || !inviteExpiresAt) return undefined;

    const timer = setInterval(() => {
      const remaining = Math.max(0, Math.floor((inviteExpiresAt - Date.now()) / 1000));
      setInviteTimeLeft(remaining);
      if (remaining <= 0) {
        clearInterval(timer);
      }
    }, 1000);

    return () => clearInterval(timer);
  }, [showInviteModal, inviteExpiresAt]);

  const handleCopyInviteUrl = async () => {
    try {
      await navigator.clipboard.writeText(inviteUrl);
      setInviteCopied(true);
      setTimeout(() => setInviteCopied(false), 3000);
    } catch {
      // Fallback
    }
  };

  const handleShareInviteUrl = async () => {
    if (navigator.share) {
      try {
        await navigator.share({
          title: "Parashu Admin Invitation",
          text: "Scan or open this link to request Parashu Administrator access:",
          url: inviteUrl,
        });
      } catch {
        // Share cancelled
      }
    } else {
      handleCopyInviteUrl();
    }
  };

  const handleApproveRequest = async (id) => {
    try {
      const res = await approveAdminRequest(id);
      if (res.success) {
        setStatusMessage(res.message || "Admin request approved.");
        loadAdminsAndRequests();
      }
    } catch (err) {
      setStatusMessage(err?.response?.data?.message || "Failed to approve admin request.");
    }
  };

  const handleRejectRequest = async (id) => {
    try {
      const res = await rejectAdminRequest(id);
      if (res.success) {
        setStatusMessage(res.message || "Admin request rejected.");
        loadAdminsAndRequests();
      }
    } catch (err) {
      setStatusMessage(err?.response?.data?.message || "Failed to reject admin request.");
    }
  };

  const handleDeleteAdmin = async (adminId, adminEmail) => {
    if (!window.confirm(`Are you sure you want to remove ${adminEmail} from administrators?`)) {
      return;
    }
    try {
      const res = await deleteAdmin(adminId);
      if (res.success) {
        setStatusMessage(`Administrator ${adminEmail} removed.`);
        loadAdminsAndRequests();
      }
    } catch (err) {
      setStatusMessage(err?.response?.data?.message || "Failed to remove admin.");
    }
  };

  const handleDeleteHistoryConfirm = async () => {
    setClearingHistory(true);
    setDeleteSuccessMsg("");
    try {
      const res = await clearResolvedHistory();
      if (res.success) {
        setHistory([]);
        setShowDeleteModal(false);
        setDeleteSuccessMsg("All resolved history records have been deleted.");
        setTimeout(() => setDeleteSuccessMsg(""), 5000);
      }
    } catch (err) {
      const errMsg = err?.response?.data?.message || err?.message || "Deletion failed";
      setStatusMessage(`Delete failed: ${errMsg}`);
    } finally {
      setClearingHistory(false);
    }
  };

  const selected = useMemo(
    () => activeAlerts.find((alert) => alert.id === selectedId) || null,
    [activeAlerts, selectedId]
  );

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
      announcedAlertIdsRef.current.delete(alert.id);
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
        {audioBlocked && (
          <div className="pa-audio-notice-banner">
            <div className="pa-audio-notice-text">
              <Volume2 size={16} />
              <span>Siren audio was muted by browser autoplay policy. Click to unlock emergency siren alerts.</span>
            </div>
            <button
              type="button"
              className="pa-btn pa-btn--primary"
              onClick={() => {
                if (sirenRef.current) {
                  sirenRef.current.play().then(() => sirenRef.current.pause()).catch(() => {});
                }
                setAudioBlocked(false);
              }}
            >
              Enable Siren Sound
            </button>
          </div>
        )}

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

                    {/* Nearby Emergency Medical Facilities / Hospitals */}
                    <NearbyHospitalsList alert={alert} />

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
              <h3>{item.user_name}</h3>
              <p>{item.phone} · {item.email}</p>
              <span className="pa-meta-line">
                Resolved {formatTime(item.updated_at || item.created_at)}
              </span>
            </div>
            <span className="pa-pill pa-pill--resolved">Resolved</span>
          </article>
        ))}
      </div>
    </section>
  );

  const renderAdminsView = () => (
    <section className="pa-adm">
      <div className="pa-adm__head">
        <div>
          <p className="pa-kicker">Access control</p>
          <h2>Administrator Management</h2>
        </div>
        <button
          type="button"
          className="pa-adm__add"
          onClick={handleGenerateInvitation}
          disabled={inviteLoading}
        >
          <QrCode size={16} strokeWidth={1.9} />
          <span>{inviteLoading ? "Generating QR…" : "Add New Admin"}</span>
        </button>
      </div>

      {adminsError && <div className="pa-adm__error">{adminsError}</div>}

      <div className="pa-adm__group">
        <h3 className="pa-adm__grouptitle">
          <Clock size={16} strokeWidth={2} className="pa-adm__groupicon pa-adm__groupicon--warn" />
          Pending Admin Requests ({adminRequests.length})
        </h3>

        {adminRequests.length === 0 ? (
          <div className="pa-adm__empty">
            <CheckCircle2 size={18} strokeWidth={1.9} />
            <p>No pending admin requests at this time.</p>
          </div>
        ) : (
          <div className="pa-adm__list">
            {adminRequests.map((req) => (
              <article key={req.id} className="pa-adm__row pa-adm__row--pending">
                <span className="pa-adm__avatar pa-adm__avatar--warn">
                  {initialOf(req.name, req.email)}
                </span>

                <div className="pa-adm__ident">
                  <div className="pa-adm__nameline">
                    <strong>{req.name || "Unnamed request"}</strong>
                    <span className="pa-adm__tag pa-adm__tag--warn">Pending approval</span>
                  </div>
                  <p className="pa-adm__sub">
                    {req.email}
                    <span className="pa-adm__dot">·</span>
                    Requested {formatTime(req.created_at)}
                  </p>
                </div>

                <div className="pa-adm__actions">
                  <button
                    type="button"
                    className="pa-adm__act pa-adm__act--approve"
                    onClick={() => handleApproveRequest(req.id)}
                  >
                    <Check size={15} strokeWidth={2.2} />
                    <span>Approve</span>
                  </button>
                  <button
                    type="button"
                    className="pa-adm__act pa-adm__act--reject"
                    onClick={() => handleRejectRequest(req.id)}
                  >
                    <X size={15} strokeWidth={2.2} />
                    <span>Reject</span>
                  </button>
                </div>
              </article>
            ))}
          </div>
        )}
      </div>

      <div className="pa-adm__group">
        <h3 className="pa-adm__grouptitle">
          <ShieldCheck size={16} strokeWidth={2} className="pa-adm__groupicon pa-adm__groupicon--info" />
          Active Administrators ({admins.length})
        </h3>

        {adminsLoading ? (
          <div className="pa-adm__empty">
            <Clock size={18} strokeWidth={1.9} />
            <p>Loading admin directory…</p>
          </div>
        ) : admins.length === 0 ? (
          <div className="pa-adm__empty">
            <ShieldAlert size={18} strokeWidth={1.9} />
            <p>No administrators are registered yet.</p>
          </div>
        ) : (
          <div className="pa-adm__list">
            {admins.map((adm) => {
              const isSelf = adm.user_id === user?.id;

              return (
                <article key={adm.user_id} className="pa-adm__row">
                  <span className="pa-adm__avatar pa-adm__avatar--info">
                    {initialOf(adm.name, adm.email)}
                  </span>

                  <div className="pa-adm__ident">
                    <div className="pa-adm__nameline">
                      <strong>{adm.name || adm.email || "Administrator"}</strong>
                      {isSelf && <span className="pa-adm__tag">You</span>}
                    </div>
                    <p className="pa-adm__sub">
                      {adm.email}
                      <span className="pa-adm__dot">·</span>
                      ID: <span className="pa-mono">{shortId(adm.user_id)}</span>
                    </p>
                  </div>

                  <div className="pa-adm__actions">
                    <span className="pa-adm__stamp">Added {formatTime(adm.created_at)}</span>
                    {admins.length > 1 && (
                      <button
                        type="button"
                        className="pa-adm__act pa-adm__act--remove"
                        onClick={() => handleDeleteAdmin(adm.user_id, adm.email || adm.user_id)}
                        title="Remove administrator"
                      >
                        <Trash2 size={15} strokeWidth={1.9} />
                        <span>Remove</span>
                      </button>
                    )}
                  </div>
                </article>
              );
            })}
          </div>
        )}
      </div>
    </section>
  );

  return (
    <div className="pa-dashboard-page">
      <aside className="pa-sidebar">
        <div className="pa-sidebar__brand">
          <span className="pa-sidebar__mark">
            <img src="/symbol.png" alt="" />
          </span>
          <div>
            <span className="pa-sidebar__title">Parashu</span>
            <span className="pa-sidebar__sub">Control Room</span>
          </div>
        </div>

        <nav className="pa-sidebar__nav">
          <button
            type="button"
            className={`pa-nav-item${tab === "active" ? " is-active" : ""}`}
            onClick={() => setTab("active")}
          >
            <AlertTriangle size={17} strokeWidth={1.9} />
            <span>Active SOS</span>
            {activeAlerts.length > 0 && (
              <span className="pa-badge pa-badge--danger">{activeAlerts.length}</span>
            )}
          </button>

          <button
            type="button"
            className={`pa-nav-item${tab === "history" ? " is-active" : ""}`}
            onClick={() => setTab("history")}
          >
            <History size={17} strokeWidth={1.9} />
            <span>History</span>
          </button>

          <button
            type="button"
            className={`pa-nav-item${tab === "admins" ? " is-active" : ""}`}
            onClick={() => setTab("admins")}
          >
            <ShieldCheck size={17} strokeWidth={1.9} />
            <span>Admins</span>
            {adminRequests.length > 0 && (
              <span className="pa-badge pa-badge--danger">{adminRequests.length}</span>
            )}
          </button>
        </nav>

        <div className="pa-sidebar__foot">
          <div className="pa-sidebar__user">
            <span className="pa-sidebar__avatar">
              <UserRound size={16} strokeWidth={1.9} />
            </span>
            <div className="pa-user-info">
              <span className="pa-user-name">{user?.name || "Administrator"}</span>
              <span className="pa-user-email">{user?.email}</span>
            </div>
          </div>

          <button type="button" className="pa-logout" onClick={signOut}>
            <LogOut size={16} strokeWidth={1.9} />
            <span>Logout</span>
          </button>
        </div>
      </aside>

      <main className="pa-main">
        <header className="pa-topbar">
          <div className="pa-topbar__heading">
            <p className="pa-kicker">Parashu Command Center</p>
            <h1>{PAGE_TITLES[tab] || "Control Room"}</h1>
          </div>

          <div className="pa-topbar__meta">
            <button
              type="button"
              className={`pa-chip pa-chip--toggle${prefs.sirenOnNewAlert ? " is-on" : ""}`}
              onClick={() => togglePref("sirenOnNewAlert")}
              title="Toggle emergency siren on new alert"
            >
              <Volume2 size={14} strokeWidth={1.9} />
              <span>Siren {prefs.sirenOnNewAlert ? "on" : "off"}</span>
            </button>

            <span className="pa-chip">
              <BellRing size={14} strokeWidth={1.9} />
              <span>{statusMessage}</span>
            </span>

            <span className={`pa-chip${activeAlerts.length > 0 ? " pa-chip--danger" : ""}`}>
              <AlertTriangle size={14} strokeWidth={1.9} />
              <span>{activeAlerts.length} active</span>
            </span>
          </div>
        </header>

        <div className="pa-dashboard-content">
          {tab === "active" && renderActiveView()}
          {tab === "history" && renderHistoryView()}
          {tab === "admins" && renderAdminsView()}
        </div>
      </main>

      {/* Delete Resolved History Modal */}
      {showDeleteModal && (
        <div className="pa-modal-overlay">
          <div className="pa-modal pa-modal--danger">
            <div className="pa-modal__head">
              <AlertTriangle size={22} className="pa-modal__icon--danger" />
              <h3>Delete Resolved History</h3>
            </div>
            <div className="pa-modal__body">
              <p>Are you sure you want to delete all resolved SOS history? This action cannot be undone.</p>
              <ul style={{ margin: "12px 0 0", paddingLeft: 20, color: "#94a3b8", fontSize: 13 }}>
                <li>Active SOS alerts will NOT be deleted.</li>
                <li>User &amp; admin accounts will NOT be deleted.</li>
              </ul>
            </div>
            <div className="pa-modal__actions">
              <button
                type="button"
                className="pa-btn pa-btn--ghost"
                onClick={() => setShowDeleteModal(false)}
                disabled={clearingHistory}
              >
                Cancel
              </button>
              <button
                type="button"
                className="pa-btn pa-btn--danger"
                onClick={handleDeleteHistoryConfirm}
                disabled={clearingHistory}
              >
                {clearingHistory ? "Deleting…" : "Confirm Delete"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Admin QR Invitation Modal */}
      {showInviteModal && (
        <div className="pa-modal-overlay">
          <div className="pa-modal pa-modal--invite" style={{ maxWidth: 440, textAlign: "center" }}>
            <div className="pa-modal__head" style={{ justifyContent: "center", marginBottom: 12 }}>
              <QrCode size={24} style={{ color: "#38bdf8" }} />
              <h3 style={{ margin: 0 }}>Invite New Administrator</h3>
            </div>

            <div className="pa-modal__body" style={{ padding: "8px 0 16px" }}>
              <p style={{ margin: "0 0 16px", fontSize: 13, color: "#94a3b8" }}>
                Scan this QR code or share the invitation link with the person you want to add as an administrator.
              </p>

              {/* QR Code Container */}
              {qrDataUrl && (
                <div style={{ background: "#ffffff", padding: 12, borderRadius: 16, display: "inline-block", boxShadow: "0 8px 24px rgba(0, 0, 0, 0.4)" }}>
                  <img src={qrDataUrl} alt="Admin Invite QR Code" style={{ width: 200, height: 200, display: "block" }} />
                </div>
              )}

              {/* Expiration Countdown Timer */}
              <div style={{ margin: "16px 0 12px", display: "inline-flex", alignItems: "center", gap: 6, background: "rgba(239, 68, 68, 0.12)", border: "1px solid rgba(239, 68, 68, 0.3)", padding: "6px 14px", borderRadius: 999, color: "#f87171", fontSize: 13, fontWeight: 700 }}>
                <Clock size={14} />
                <span>
                  Expires in: {Math.floor(inviteTimeLeft / 60).toString().padStart(2, "0")}:{(inviteTimeLeft % 60).toString().padStart(2, "0")}
                </span>
              </div>

              {inviteTimeLeft <= 0 && (
                <div style={{ color: "#ef4444", fontSize: 12, fontWeight: 600, marginBottom: 8 }}>
                  This invitation link has expired. Please generate a new one.
                </div>
              )}

              {/* Unique Invitation URL Display */}
              <div style={{ background: "rgba(15, 23, 42, 0.6)", border: "1px solid rgba(255, 255, 255, 0.1)", padding: "8px 12px", borderRadius: 8, fontSize: 12, wordBreak: "break-all", color: "#38bdf8", fontFamily: "monospace", margin: "8px 0 16px" }}>
                {inviteUrl}
              </div>
            </div>

            <div className="pa-modal__actions" style={{ justifyContent: "center", gap: 12 }}>
              <button
                type="button"
                className="pa-btn pa-btn--primary"
                onClick={handleShareInviteUrl}
                disabled={inviteTimeLeft <= 0}
              >
                <Share2 size={14} />
                <span>Share Link</span>
              </button>

              <button
                type="button"
                className="pa-btn pa-btn--ghost"
                onClick={handleCopyInviteUrl}
                disabled={inviteTimeLeft <= 0}
              >
                <Copy size={14} />
                <span>{inviteCopied ? "Copied!" : "Copy Link"}</span>
              </button>

              <button
                type="button"
                className="pa-btn pa-btn--ghost"
                onClick={() => setShowInviteModal(false)}
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
