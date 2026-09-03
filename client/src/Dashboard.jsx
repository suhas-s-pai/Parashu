import { useCallback, useEffect, useMemo, useRef, useState } from "react";
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
  fetchNearbyFacilities,
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
  Search,
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
  const earthRadiusKm = 6371;
  const toRadians = (value) => value * (Math.PI / 180);
  const dLat = toRadians(lat2 - lat1);
  const dLon = toRadians(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRadians(lat1)) *
      Math.cos(toRadians(lat2)) *
      Math.sin(dLon / 2) ** 2;

  return earthRadiusKm * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function FacilityCards({ facilities, emptyMessage }) {
  if (facilities.length === 0) {
    return <div className="pa-hospitals-status">{emptyMessage}</div>;
  }

  return (
    <div className="pa-hospitals-list">
      {facilities.map((facility) => (
        <div key={facility.id} className="pa-hospital-card">
          <div className="pa-hospital-info">
            <div className="pa-hospital-name">{facility.name}</div>
            <div className="pa-hospital-addr">
              {facility.address || "Address available on map"}
            </div>
            {facility.phone && (
              <div className="pa-hospital-phone">📞 {facility.phone}</div>
            )}
          </div>
          <div className="pa-hospital-side">
            <span className="pa-hospital-dist">
              {facility.distanceKm < 1
                ? `${Math.round(facility.distanceKm * 1000)} m`
                : `${facility.distanceKm.toFixed(1)} km`}
            </span>
            <a
              href={`https://www.google.com/maps/search/?api=1&query=${facility.lat},${facility.lon}`}
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
  );
}

// One request supplies both lists and is tied to coordinate primitives so the
// five-second alert refresh does not restart a lookup that is still in flight.
function NearbyFacilitiesList({ alert }) {
  const latitude = alert?.latitude;
  const longitude = alert?.longitude;
  const alertId = alert?.id;
  const [facilities, setFacilities] = useState({
    hospitals: [],
    policeStations: [],
  });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const lookupRef = useRef(null);

  useEffect(() => {
    if (!alertId || !Number.isFinite(latitude) || !Number.isFinite(longitude)) {
      return;
    }

    let isMounted = true;
    const previousLookup = lookupRef.current;
    const movedKm = previousLookup
      ? getDistanceKm(
          previousLookup.latitude,
          previousLookup.longitude,
          latitude,
          longitude
        )
      : Infinity;

    if (
      !previousLookup ||
      previousLookup.alertId !== alertId ||
      movedKm >= 1 ||
      !previousLookup.promise
    ) {
      lookupRef.current = {
        alertId,
        latitude,
        longitude,
        promise: fetchNearbyFacilities(latitude, longitude),
      };
    }

    const activeLookup = lookupRef.current;
    setLoading(true);
    setError("");

    const loadFacilities = async () => {
      try {
        const data = await activeLookup.promise;
        if (!isMounted) return;

        setFacilities(data);
      } catch (requestError) {
        if (isMounted) {
          if (lookupRef.current === activeLookup) {
            lookupRef.current = { ...activeLookup, promise: null };
          }
          setError(
            requestError?.response?.data?.message ||
              "Unable to load nearby facilities right now."
          );
        }
      } finally {
        if (isMounted) setLoading(false);
      }
    };

    loadFacilities();

    return () => {
      isMounted = false;
    };
  }, [alertId, latitude, longitude]);

  return (
    <>
      <div className="pa-nearby-hospitals-box">
        <div className="pa-nearby-hospitals-header">
          <span className="pa-hospitals-title">🏥 Nearby Emergency Medical Facilities</span>
          <span className="pa-hospitals-subtitle">Within 5 km</span>
        </div>

        {loading && <div className="pa-hospitals-status">Searching nearby facilities…</div>}
        {error && !loading && <div className="pa-hospitals-status pa-hospitals-error">{error}</div>}
        {!loading && !error && (
          <FacilityCards
            facilities={facilities.hospitals}
            emptyMessage="No hospitals found within 5 km."
          />
        )}
      </div>

      <div className="pa-nearby-hospitals-box">
        <div className="pa-nearby-hospitals-header">
          <span className="pa-hospitals-title">🛡️ Nearby Police Stations</span>
          <span className="pa-hospitals-subtitle">Within 5 km</span>
        </div>

        {loading && <div className="pa-hospitals-status">Searching nearby facilities…</div>}
        {error && !loading && <div className="pa-hospitals-status pa-hospitals-error">{error}</div>}
        {!loading && !error && (
          <FacilityCards
            facilities={facilities.policeStations}
            emptyMessage="No police stations found within 5 km."
          />
        )}
      </div>
    </>
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
  const [inviteToken, setInviteToken] = useState("");
  const [inviteExpiresAt, setInviteExpiresAt] = useState(null);
  const [inviteCreatedAt, setInviteCreatedAt] = useState(null);
  const [inviteTimeLeft, setInviteTimeLeft] = useState(300);
  const [inviteLoading, setInviteLoading] = useState(false);
  const [inviteCopied, setInviteCopied] = useState(false);
  const inviteReceivedAtRef = useRef(null);

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
      const code = res?.code || res?.token || res?.invitation?.code || res?.invitation?.token;
      const expiresAt = Number(
        res?.expiresAt || res?.expires_at || res?.invitation?.expires_at || res?.invitation?.expiresAt
      );
      const createdAtRaw = res?.createdAt || res?.created_at || res?.invitation?.created_at;
      const createdAt = createdAtRaw ? new Date(createdAtRaw).getTime() : expiresAt - 300000;

      if (res?.success && code && Number.isFinite(expiresAt)) {
        inviteReceivedAtRef.current = Date.now();
        setInviteToken(code);
        setInviteExpiresAt(expiresAt);
        setInviteCreatedAt(createdAt);

        // Always starts at exactly 300 seconds (05:00) at moment of creation
        const initialRemaining = Math.min(300, Math.max(0, Math.floor((expiresAt - createdAt) / 1000)));
        setInviteTimeLeft(initialRemaining > 0 ? initialRemaining : 300);
        setShowInviteModal(true);
      } else {
        setStatusMessage("Failed to generate admin invitation code.");
      }
    } catch {
      setStatusMessage("Failed to generate admin invitation code.");
    } finally {
      setInviteLoading(false);
    }
  };

  useEffect(() => {
    if (!showInviteModal || !inviteExpiresAt || !Number.isFinite(Number(inviteExpiresAt))) {
      return undefined;
    }

    const expiresAtMs = Number(inviteExpiresAt);
    const createdAtMs = Number(inviteCreatedAt || (expiresAtMs - 300000));
    const receivedAtMs = inviteReceivedAtRef.current || Date.now();
    const totalDurationMs = Math.min(300000, Math.max(0, expiresAtMs - createdAtMs));

    const updateTimer = () => {
      const elapsedMs = Date.now() - receivedAtMs;
      const remainingMs = totalDurationMs - elapsedMs;
      const remainingSeconds = Math.min(300, Math.max(0, Math.floor(remainingMs / 1000)));
      setInviteTimeLeft(remainingSeconds);
      return remainingSeconds;
    };

    updateTimer();

    const timer = setInterval(() => {
      const remaining = updateTimer();
      if (remaining <= 0) {
        clearInterval(timer);
      }
    }, 1000);

    return () => clearInterval(timer);
  }, [showInviteModal, inviteExpiresAt, inviteCreatedAt]);

  const handleCopyCode = async () => {
    try {
      await navigator.clipboard.writeText(inviteToken);
      setInviteCopied(true);
      setTimeout(() => setInviteCopied(false), 3000);
    } catch {
      // Fallback
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
                    <NearbyFacilitiesList alert={alert} />

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
          <UserRound size={16} strokeWidth={1.9} />
          <span>{inviteLoading ? "Generating Code…" : "Add New Admin"}</span>
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

      {/* Admin 6-Digit Code Invitation Modal */}
      {showInviteModal && (
        <div className="pa-modal-overlay">
          <div className="pa-modal pa-modal--invite" style={{ maxWidth: 420, textAlign: "center" }}>
            <div className="pa-modal__head" style={{ justifyContent: "center", marginBottom: 8 }}>
              <UserRound size={22} style={{ color: "#38bdf8" }} />
              <h3 style={{ margin: 0 }}>Invite New Administrator</h3>
            </div>

            <div className="pa-modal__body" style={{ padding: "8px 0 16px" }}>
              <p style={{ margin: "0 0 14px", fontSize: 13, color: "#94a3b8" }}>
                Generate a temporary admin login code and share it with the person you want to add.
              </p>

              {/* 4-Digit Code Display */}
              <div style={{ background: "rgba(15, 23, 42, 0.8)", border: "1px solid rgba(56, 189, 248, 0.3)", padding: "16px 24px", borderRadius: 12, margin: "8px auto 14px", display: "inline-block", boxShadow: "0 4px 20px rgba(0, 0, 0, 0.3)" }}>
                <span style={{ fontSize: 34, fontWeight: 800, letterSpacing: "0.2em", color: "#38bdf8", fontFamily: "monospace" }}>
                  {inviteToken || "----"}
                </span>
              </div>

              {/* Expiration Countdown Timer */}
              <div>
                <div style={{ margin: "4px 0 8px", display: "inline-flex", alignItems: "center", gap: 6, background: "rgba(239, 68, 68, 0.12)", border: "1px solid rgba(239, 68, 68, 0.3)", padding: "6px 14px", borderRadius: 999, color: "#f87171", fontSize: 13, fontWeight: 700 }}>
                  <Clock size={14} />
                  <span>
                    Expires in: {Math.floor(inviteTimeLeft / 60).toString().padStart(2, "0")}:{(inviteTimeLeft % 60).toString().padStart(2, "0")}
                  </span>
                </div>
              </div>

              {inviteTimeLeft <= 0 && (
                <div style={{ color: "#ef4444", fontSize: 12, fontWeight: 600, marginTop: 4 }}>
                  This invitation code has expired. Please generate a new one.
                </div>
              )}
            </div>

            <div className="pa-modal__actions" style={{ justifyContent: "center", gap: 12 }}>
              <button
                type="button"
                className="pa-btn pa-btn--primary"
                onClick={handleCopyCode}
                disabled={inviteTimeLeft <= 0}
              >
                <Copy size={14} />
                <span>{inviteCopied ? "Copied!" : "Copy Code"}</span>
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
