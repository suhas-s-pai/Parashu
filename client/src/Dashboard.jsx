import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ShieldAlert,
  CheckCircle2,
  Phone,
  Clock,
  MapPin,
  Copy,
  Check,
  ExternalLink,
  Volume2,
  Navigation,
  Building2,
  Crosshair,
  Mic,
  Radio,
  BellRing,
  QrCode,
  RotateCcw,
  X,
} from "lucide-react";
import QRCode from "qrcode";
import CommandShell from "./CommandShell";
import {
  getAlertStreamUrl,
  fetchActiveAlerts,
  resolveAlert,
  generateAdminInvitation,
} from "./lib/api";
import {
  formatTime,
  googleMapsUrl,
  normalizeAlert,
} from "./lib/alerts";
import { DEFAULT_PREFS, usePrefs } from "./lib/prefs";

function priorityOf(createdAt) {
  const minutes = (Date.now() - new Date(createdAt).getTime()) / 60000;
  if (minutes < 3) return { level: "P1", cls: "", chip: "ks-chip--red", label: "Critical" };
  if (minutes < 12) return { level: "P2", cls: "ks-alert--p2", chip: "ks-chip--amber", label: "Elevated" };
  return { level: "P3", cls: "ks-alert--p3", chip: "ks-chip--blue", label: "Standing" };
}

function elapsedSince(createdAt) {
  const seconds = Math.max(0, Math.floor((Date.now() - new Date(createdAt).getTime()) / 1000));
  if (seconds < 60) return `${seconds}s`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ${seconds % 60}s`;
  return `${Math.floor(seconds / 3600)}h ${Math.floor((seconds % 3600) / 60)}m`;
}

function distanceKm(origin, lat, lon) {
  if (!origin || !Number.isFinite(lat) || !Number.isFinite(lon)) return null;
  const toRad = (d) => (d * Math.PI) / 180;
  const R = 6371;
  const dLat = toRad(lat - origin.lat);
  const dLon = toRad(lon - origin.lon);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(origin.lat)) * Math.cos(toRad(lat)) * Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function osmEmbed(lat, lon, span = 0.012) {
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return "";
  const bbox = [lon - span, lat - span * 0.75, lon + span, lat + span * 0.75].join(",");
  return `https://www.openstreetmap.org/export/embed.html?bbox=${bbox}&layer=mapnik&marker=${lat},${lon}`;
}

export default function Dashboard({ focus }) {
  const [prefsObj, togglePref] = usePrefs();
  const prefs = prefsObj || DEFAULT_PREFS;

  const [alerts, setAlerts] = useState([]);
  const [selectedId, setSelectedId] = useState(null);
  const [copiedId, setCopiedId] = useState(null);
  const [origin, setOrigin] = useState(null);
  const [statusMessage, setStatusMessage] = useState("Connecting to live feed…");
  const [audioBlocked, setAudioBlocked] = useState(false);

  const [showInviteModal, setShowInviteModal] = useState(false);
  const [qrDataUrl, setQrDataUrl] = useState("");
  const [inviteExpiresAt, setInviteExpiresAt] = useState(null);
  const [timeLeftSeconds, setTimeLeftSeconds] = useState(300);
  const [generatingInvite, setGeneratingInvite] = useState(false);

  const knownIdsRef = useRef(new Set());
  const initialLoadCompleteRef = useRef(false);
  const sirenRef = useRef(null);
  const sirenTimeoutRef = useRef(null);
  const sirenEnabledRef = useRef(prefs?.sirenOnNewAlert ?? true);

  useEffect(() => {
    sirenEnabledRef.current = prefs?.sirenOnNewAlert ?? true;
  }, [prefs?.sirenOnNewAlert]);

  // Fail-safe 4-second siren player
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
            console.warn("Siren audio playback rejected by browser:", err);
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

  const announce = useCallback(
    (incomingAlerts) => {
      const fresh = incomingAlerts.filter((a) => !knownIdsRef.current.has(a.id));

      // Register all incoming IDs into known Set
      incomingAlerts.forEach((a) => knownIdsRef.current.add(a.id));

      // Suppress siren on initial mount / DB snapshot
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
    },
    [playSiren4Seconds]
  );

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
        const rawAlerts = await fetchActiveAlerts();
        const norm = (rawAlerts || []).map(normalizeAlert);
        if (cancelled) return;
        setAlerts(norm);
        norm.forEach((a) => knownIdsRef.current.add(a.id));
        initialLoadCompleteRef.current = true;
        setStatusMessage("Listening for active emergencies");
      } catch {
        if (!cancelled) setStatusMessage("Unable to reach backend stream");
      }
    };

    load();

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!prefs?.realtime) return undefined;

    let source = null;
    let closed = false;

    const apply = (event, isUpdate) => {
      try {
        const payload = JSON.parse(event.data);
        const norm = (payload.alerts || []).map(normalizeAlert);
        setAlerts(norm);

        if (isUpdate) {
          announce(norm);
        } else {
          norm.forEach((a) => knownIdsRef.current.add(a.id));
          initialLoadCompleteRef.current = true;
          setStatusMessage("Realtime stream operational");
        }
      } catch (err) {
        console.error("Stream parse error:", err);
      }
    };

    const connect = async () => {
      try {
        const url = await getAlertStreamUrl();
        if (closed) return;

        source = new EventSource(url);
        source.addEventListener("snapshot", (event) => apply(event, false));
        source.addEventListener("update", (event) => apply(event, true));
        source.onerror = () => {
          setStatusMessage("Realtime stream disconnected. Retrying…");
        };
      } catch {
        setStatusMessage("Unable to establish stream connection");
      }
    };

    connect();

    return () => {
      closed = true;
      source?.close();
    };
  }, [announce, prefs?.realtime]);

  const handleResolveAlert = async (id) => {
    try {
      await resolveAlert(id);
      setAlerts((prev) => prev.filter((a) => a.id !== id));
      knownIdsRef.current.delete(id);
      if (selectedId === id) setSelectedId(null);
      setStatusMessage("Emergency alert marked resolved");
    } catch {
      setStatusMessage("Failed to mark alert as resolved");
    }
  };

  const selected = useMemo(
    () => alerts.find((a) => a.id === selectedId) || alerts[0] || null,
    [alerts, selectedId]
  );

  const copyCoordinates = async (alertItem) => {
    const text = `${alertItem.latitude}, ${alertItem.longitude}`;
    try {
      await navigator.clipboard.writeText(text);
      setCopiedId(alertItem.id);
      setTimeout(() => setCopiedId(null), 1500);
    } catch {
      window.prompt("Copy coordinates", text);
    }
  };

  const pinControlRoom = () => {
    if (!navigator.geolocation) {
      alert("Geolocation is not supported by your browser.");
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setOrigin({ lat: pos.coords.latitude, lon: pos.coords.longitude });
      },
      () => {
        alert("Unable to acquire control room GPS position.");
      }
    );
  };

  const handleOpenInviteModal = async () => {
    setGeneratingInvite(true);
    setShowInviteModal(true);

    try {
      const res = await generateAdminInvitation();
      if (res?.success && res.token) {
        const fullUrl = `${window.location.origin}/admin/invite/${res.token}`;
        setInviteExpiresAt(res.expiresAt);
        setTimeLeftSeconds(300);

        const dataUrl = await QRCode.toDataURL(fullUrl, {
          width: 240,
          margin: 2,
          color: { dark: "#0f172a", light: "#ffffff" },
        });
        setQrDataUrl(dataUrl);
      }
    } catch {
      // Invite generation error
    } finally {
      setGeneratingInvite(false);
    }
  };

  useEffect(() => {
    if (!showInviteModal || !inviteExpiresAt) return undefined;

    const timer = setInterval(() => {
      const remaining = Math.max(0, Math.floor((inviteExpiresAt - Date.now()) / 1000));
      setTimeLeftSeconds(remaining);
      if (remaining <= 0) clearInterval(timer);
    }, 1000);

    return () => clearInterval(timer);
  }, [showInviteModal, inviteExpiresAt]);

  const feedOnly = focus === "feed";

  const statsRow = (
    <div className="ks-stats">
      <div className="ks-stat ks-stat--red">
        <div className="ks-stat__top">
          <ShieldAlert size={15} />
          <span>Active Emergencies</span>
        </div>
        <div className="ks-stat__value">{alerts.length}</div>
        <p className="ks-stat__meta">Requires immediate response</p>
      </div>

      <div className="ks-stat ks-stat--green">
        <div className="ks-stat__top">
          <CheckCircle2 size={15} />
          <span>System Status</span>
        </div>
        <div className="ks-stat__value ks-stat__value--sm">Operational</div>
        <p className="ks-stat__meta">Realtime SSE feed online</p>
      </div>

      <div className="ks-stat">
        <div className="ks-stat__top">
          <Phone size={15} />
          <span>Monitored Devices</span>
        </div>
        <div className="ks-stat__value">{new Set(alerts.map((a) => a.phone)).size || alerts.length}</div>
        <p className="ks-stat__meta">Unique mobile endpoints</p>
      </div>

      <div className="ks-stat">
        <div className="ks-stat__top">
          <Building2 size={15} />
          <span>Standby Teams</span>
        </div>
        <div className="ks-stat__value">12</div>
        <p className="ks-stat__meta">Control units active</p>
      </div>

      <div className="ks-stat">
        <div className="ks-stat__top">
          <Clock size={15} />
          <span>Avg Dispatch</span>
        </div>
        <div className="ks-stat__value ks-stat__value--sm">1.8 min</div>
        <p className="ks-stat__meta">Response time benchmark</p>
      </div>

      <div className="ks-stat">
        <div className="ks-stat__top">
          <BellRing size={15} />
          <span>Siren Alerts</span>
        </div>
        <div className="ks-stat__value ks-stat__value--sm">
          {prefs?.sirenOnNewAlert ? "4s Audio On" : "Muted"}
        </div>
        <button
          type="button"
          className="ks-btn ks-btn--ghost ks-btn--sm"
          style={{ marginTop: 6, width: "100%", justifyContent: "center" }}
          onClick={() => togglePref("sirenOnNewAlert")}
        >
          {prefs?.sirenOnNewAlert ? "Mute Siren" : "Enable Siren"}
        </button>
      </div>
    </div>
  );

  const feed = (
    <section className="ks-feedwrap">
      <div className="ks-sectionhead">
        <ShieldAlert size={16} style={{ color: "var(--emergency)" }} />
        <h2>Live Emergency Feed</h2>
        <span className="ks-chip ks-chip--red" style={{ marginLeft: 8 }}>
          {alerts.length} active
        </span>
        <div className="ks-sectionhead__spacer" />
        <button
          type="button"
          className={`ks-btn ks-btn--sm${origin ? " ks-btn--success" : " ks-btn--ghost"}`}
          onClick={pinControlRoom}
        >
          <Crosshair size={14} />
          {origin ? "Origin Pinned" : "Pin Control Room Origin"}
        </button>
      </div>

      {audioBlocked && (
        <div
          style={{
            margin: "0 0 16px",
            padding: "10px 14px",
            borderRadius: 10,
            background: "rgba(234, 179, 8, 0.12)",
            border: "1px solid rgba(234, 179, 8, 0.35)",
            color: "#fde047",
            fontSize: 13,
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <Volume2 size={16} />
            <span>Siren sound blocked by browser policy. Click button to enable audio alerts.</span>
          </div>
          <button
            type="button"
            className="ks-btn ks-btn--sm ks-btn--primary"
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

      <div className="ks-feed">
        {alerts.length === 0 && (
          <div className="ks-card">
            <div className="ks-empty">
              <CheckCircle2 size={24} strokeWidth={1.8} style={{ color: "#4ade80" }} />
              <h3>No Active Emergencies</h3>
              <p>The control room feed is monitored continuously. Realtime alerts appear here instantly.</p>
            </div>
          </div>
        )}

        {alerts.map((alertItem) => {
          const priority = priorityOf(alertItem.created_at);
          const dist = distanceKm(origin, Number(alertItem.latitude), Number(alertItem.longitude));
          const isSelected = selected && selected.id === alertItem.id;

          return (
            <article
              key={alertItem.id}
              className={`ks-alert ${priority.cls}${isSelected ? " is-selected" : ""}`}
              onClick={() => setSelectedId(alertItem.id)}
            >
              <header className="ks-alert__head">
                <span className="ks-avatar">
                  {String(alertItem.user_name || "?").trim().charAt(0).toUpperCase()}
                </span>

                <div className="ks-alert__id">
                  <h3>{alertItem.user_name}</h3>
                  <div className="ks-alert__sub">
                    <a href={`tel:${alertItem.phone}`} onClick={(e) => e.stopPropagation()}>
                      <Phone size={12} />
                      {alertItem.phone}
                    </a>
                    <span>
                      <Clock size={12} style={{ verticalAlign: -2, marginRight: 4 }} />
                      {formatTime(alertItem.created_at)}
                    </span>
                  </div>
                </div>

                <span className={`ks-chip ${priority.chip}`}>
                  {priority.level} · {priority.label}
                </span>
              </header>

              <div className="ks-alert__badges">
                <span className="ks-chip ks-chip--red">
                  <span className="ks-dot ks-dot--red" /> SOS Active
                </span>
                <span className="ks-chip ks-chip--ghost">
                  <Mic size={11} /> {alertItem.trigger_type || "SOS Trigger"}
                </span>
                <span className="ks-chip ks-chip--ghost">
                  <Radio size={11} /> {elapsedSince(alertItem.created_at)} elapsed
                </span>
              </div>

              <div className="ks-grid2">
                <div className="ks-kv">
                  <div className="ks-kv__k"><MapPin size={10} /> Latitude</div>
                  <div className="ks-kv__v">{alertItem.latitude}</div>
                </div>
                <div className="ks-kv">
                  <div className="ks-kv__k"><MapPin size={10} /> Longitude</div>
                  <div className="ks-kv__v">{alertItem.longitude}</div>
                </div>
                <div className="ks-kv">
                  <div className="ks-kv__k"><Navigation size={10} /> Distance</div>
                  <div className={`ks-kv__v${dist === null ? " ks-pending" : ""}`}>
                    {dist === null ? "Pin origin" : `${dist.toFixed(2)} km`}
                  </div>
                </div>
              </div>

              <div className="ks-actions" onClick={(e) => e.stopPropagation()}>
                <a
                  className="ks-btn ks-btn--sm"
                  href={googleMapsUrl(alertItem.latitude, alertItem.longitude)}
                  target="_blank"
                  rel="noreferrer"
                >
                  <ExternalLink size={14} /> Open Maps
                </a>

                <button className="ks-btn ks-btn--ghost ks-btn--sm" onClick={() => copyCoordinates(alertItem)}>
                  {copiedId === alertItem.id ? (
                    <><Check size={14} /> Copied</>
                  ) : (
                    <><Copy size={14} /> Coordinates</>
                  )}
                </button>

                <a className="ks-btn ks-btn--ghost ks-btn--sm" href={`tel:${alertItem.phone}`}>
                  <Phone size={14} /> Call
                </a>

                <button className="ks-btn ks-btn--ghost ks-btn--sm" onClick={playSiren4Seconds}>
                  <Volume2 size={14} /> 4s Siren
                </button>

                <button
                  className="ks-btn ks-btn--success ks-btn--sm"
                  onClick={() => handleResolveAlert(alertItem.id)}
                >
                  <Check size={14} /> Handle Alert
                </button>
              </div>
            </article>
          );
        })}
      </div>
    </section>
  );

  const mapPanel = (
    <aside className="ks-mappanel">
      <div className="ks-card">
        <div className="ks-card__head">
          <MapPin size={15} />
          <h2>Live Position Track</h2>
          {selected && (
            <span className="ks-chip ks-chip--red">
              <span className="ks-dot ks-dot--red" /> Tracking
            </span>
          )}
        </div>

        {selected && Number.isFinite(selected.latitude) && Number.isFinite(selected.longitude) ? (
          <>
            <div className="ks-mapwrap">
              <iframe
                className="ks-map"
                title={`Live map for ${selected.user_name}`}
                src={osmEmbed(Number(selected.latitude), Number(selected.longitude))}
                loading="lazy"
              />
            </div>

            <div className="ks-card__body" style={{ display: "grid", gap: 10 }}>
              <div className="ks-list">
                <div className="ks-list__row">
                  <span style={{ color: "var(--muted)" }}>Victim Name</span>
                  <b>{selected.user_name}</b>
                </div>
                <div className="ks-list__row">
                  <span style={{ color: "var(--muted)" }}>Phone</span>
                  <b>{selected.phone}</b>
                </div>
                <div className="ks-list__row">
                  <span style={{ color: "var(--muted)" }}>Email</span>
                  <b>{selected.email || "—"}</b>
                </div>
                <div className="ks-list__row">
                  <span style={{ color: "var(--muted)" }}>Latitude</span>
                  <b>{selected.latitude}</b>
                </div>
                <div className="ks-list__row">
                  <span style={{ color: "var(--muted)" }}>Longitude</span>
                  <b>{selected.longitude}</b>
                </div>
              </div>

              <div className="ks-actions">
                <a
                  className="ks-btn ks-btn--sm"
                  href={`https://www.google.com/maps/dir/?api=1&destination=${selected.latitude},${selected.longitude}`}
                  target="_blank"
                  rel="noreferrer"
                >
                  <Navigation size={14} /> Direct Routing
                </a>
                <a
                  className="ks-btn ks-btn--ghost ks-btn--sm"
                  href={`https://www.google.com/maps/search/police+station/@${selected.latitude},${selected.longitude},14z`}
                  target="_blank"
                  rel="noreferrer"
                >
                  <Building2 size={14} /> Police Station
                </a>
              </div>
            </div>
          </>
        ) : (
          <div className="ks-empty">
            <MapPin size={24} style={{ color: "var(--muted)" }} />
            <h3>No Position Selected</h3>
            <p>Select an active emergency card on the left to track live coordinates.</p>
          </div>
        )}
      </div>
    </aside>
  );

  return (
    <CommandShell
      title={feedOnly ? "Live Emergency Alerts" : "Emergency Operations Control Room"}
      alertCount={alerts.length}
      syncLabel={statusMessage}
      syncLive={true}
    >
      {!feedOnly && statsRow}
      {feedOnly ? feed : <div className="ks-split">{feed}{mapPanel}</div>}

      {/* Admin Invite Modal */}
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
              <span className="ks-modal__icon" style={{ background: "rgba(56, 189, 248, 0.15)", color: "#38bdf8" }}>
                <QrCode size={18} />
              </span>
              <h2>Invite Administrator</h2>
              <button
                type="button"
                className="ks-modal__close"
                onClick={() => setShowInviteModal(false)}
                aria-label="Close"
              >
                <X size={16} />
              </button>
            </div>

            <div className="ks-modal__body" style={{ textAlign: "center" }}>
              {generatingInvite ? (
                <div style={{ padding: "40px 0", color: "var(--muted)" }}>
                  <p>Generating invitation token and QR code…</p>
                </div>
              ) : (
                <>
                  <p style={{ margin: "0 0 16px", fontSize: 13, color: "var(--muted)" }}>
                    Scan QR code or copy link to invite a new administrator.
                  </p>

                  <div style={{ position: "relative", display: "inline-block", background: "#ffffff", padding: 12, borderRadius: 16 }}>
                    {qrDataUrl ? (
                      <img
                        src={qrDataUrl}
                        alt="Admin Invite QR Code"
                        style={{ width: 220, height: 220, display: "block" }}
                      />
                    ) : (
                      <div style={{ width: 220, height: 220, display: "grid", placeItems: "center", color: "#64748b" }}>
                        Generating QR…
                      </div>
                    )}
                  </div>

                  <div style={{ marginTop: 16, display: "flex", justifyContent: "center" }}>
                    <div style={{ padding: "6px 14px", borderRadius: 20, background: "rgba(234, 179, 8, 0.14)", color: "#fde047", fontSize: 13, fontWeight: 600 }}>
                      <Clock size={14} style={{ verticalAlign: -2, marginRight: 6 }} />
                      Expires in: {Math.floor(timeLeftSeconds / 60).toString().padStart(2, "0")}:{(timeLeftSeconds % 60).toString().padStart(2, "0")}
                    </div>
                  </div>

                  <div style={{ marginTop: 20, display: "grid", gap: 10 }}>
                    <button
                      type="button"
                      className="ks-btn ks-btn--danger"
                      style={{ width: "100%", justifyContent: "center" }}
                      onClick={handleOpenInviteModal}
                    >
                      <RotateCcw size={16} /> Generate New Token
                    </button>
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
    </CommandShell>
  );
}
