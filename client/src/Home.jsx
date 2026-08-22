import { useCallback, useEffect, useRef, useState } from "react";
import { Navigate } from "react-router-dom";
import axios from "axios";
import { useAuth } from "./lib/authContext";
import { fetchAlertStatus, sendSos } from "./lib/api";
import { googleMapsUrl, osmEmbedUrl, osmLinkUrl } from "./lib/alerts";
import { useVoicePrefs } from "./lib/voicePrefs";
import {
  ShieldAlert,
  Mic,
  MicOff,
  MapPin,
  ExternalLink,
  LogOut,
  Navigation,
  LayoutDashboard,
  Hospital,
  Phone,
  Check,
  Pencil,
  Settings as SettingsIcon,
  X,
  Crosshair,
  Clock,
} from "lucide-react";

const TRACKING_INTERVAL_MS = 5000;
const STATUS_POLL_INTERVAL_MS = 3000;

// The full set of phrases the Voice Protection card advertises as "listening
// for". Kept as one list so the UI can never claim a phrase works that the
// recognition handler below doesn't actually match.
const TRIGGER_PHRASES = ["help me", "sos", "emergency", "save me", "need help"];

const SENSITIVITY_OPTIONS = [
  { value: "low", label: "Low", hint: "Fewer false triggers" },
  { value: "medium", label: "Medium", hint: "Balanced (recommended)" },
  { value: "high", label: "High", hint: "Reacts to quieter speech" },
];

// Promise wrapper so the SOS flow reads top to bottom and every failure path
// ends up in one catch instead of a silently dropped callback.
function getCurrentPosition() {
  return new Promise((resolve, reject) => {
    if (!navigator.geolocation) {
      reject(new Error("Location is not supported on this device."));
      return;
    }

    navigator.geolocation.getCurrentPosition(
      (position) => resolve(position.coords),
      (error) =>
        reject(
          new Error(
            error.code === error.PERMISSION_DENIED
              ? "Allow location access so responders can find you."
              : "Could not read your location. Try again in a moment."
          )
        ),
      { enableHighAccuracy: true, timeout: 15000 }
    );
  });
}

function VoiceWaveform() {
  return (
    <span className="ks-waveform" aria-hidden="true">
      {Array.from({ length: 9 }).map((_, index) => (
        <i key={index} style={{ animationDelay: `${index * 0.09}s` }} />
      ))}
    </span>
  );
}

function VoiceSettingsModal({ prefs, setSensitivity, setAutoEnable, micPermission, voiceSupported, onClose }) {
  useEffect(() => {
    const onKeyDown = (event) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onClose]);

  const permissionChip =
    micPermission === "granted"
      ? { cls: "ks-chip--green", text: "Granted" }
      : micPermission === "denied"
      ? { cls: "ks-chip--red", text: "Blocked" }
      : { cls: "ks-chip--ghost", text: "Not requested yet" };

  return (
    <div className="ks-modal-overlay" onMouseDown={onClose}>
      <div
        className="ks-modal"
        role="dialog"
        aria-modal="true"
        aria-label="Voice protection settings"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <div className="ks-modal__head">
          <span className="ks-modal__icon"><Mic size={16} strokeWidth={2} /></span>
          <h2>Voice Protection Settings</h2>
          <button className="ks-modal__close" onClick={onClose} aria-label="Close">
            <X size={16} strokeWidth={2} />
          </button>
        </div>

        <div className="ks-modal__body">
          <div className="ks-modal__section">
            <span className="ks-modal__label">Voice sensitivity</span>
            <div className="ks-segmented">
              {SENSITIVITY_OPTIONS.map((option) => (
                <button
                  key={option.value}
                  type="button"
                  className={`ks-segmented__opt${prefs.sensitivity === option.value ? " is-active" : ""}`}
                  onClick={() => setSensitivity(option.value)}
                >
                  {option.label}
                </button>
              ))}
            </div>
            <p className="ks-modal__hint">
              {SENSITIVITY_OPTIONS.find((o) => o.value === prefs.sensitivity)?.hint}
            </p>
          </div>

          <div className="ks-modal__section">
            <span className="ks-modal__label">Supported trigger phrases</span>
            <div className="ks-phrasepills">
              {TRIGGER_PHRASES.map((phrase) => (
                <span className="ks-phrasepill" key={phrase}>“{phrase}”</span>
              ))}
            </div>
          </div>

          <div className="ks-modal__row">
            <div>
              <strong>Microphone</strong>
              <p>Web Speech API availability on this device</p>
            </div>
            <span className={`ks-chip ${voiceSupported ? "ks-chip--green" : "ks-chip--red"}`}>
              {voiceSupported ? "Supported" : "Unsupported"}
            </span>
          </div>

          <div className="ks-modal__row">
            <div>
              <strong>Permission</strong>
              <p>Browser microphone access</p>
            </div>
            <span className={`ks-chip ${permissionChip.cls}`}>{permissionChip.text}</span>
          </div>

          <div className="ks-modal__row">
            <div>
              <strong>Auto enable on open</strong>
              <p>Start listening automatically when Parashu loads</p>
            </div>
            <button
              type="button"
              className={`ks-toggle${prefs.autoEnable ? " is-on" : ""}`}
              onClick={() => setAutoEnable(!prefs.autoEnable)}
              aria-label="Auto enable voice protection"
            />
          </div>
        </div>

        <div className="ks-modal__foot">
          <button className="ks-btn ks-btn--ghost" onClick={onClose}>Cancel</button>
          <button className="ks-btn" onClick={onClose}>
            <Check size={14} strokeWidth={2} /> Save
          </button>
        </div>
      </div>
    </div>
  );
}

export default function Home() {
  const { user, savePhone, signOut } = useAuth();
  const { prefs: voicePrefs, setSensitivity, setAutoEnable } = useVoicePrefs();

  const [phase, setPhase] = useState("idle");
  const [notice, setNotice] = useState("");
  const [listening, setListening] = useState(false);
  const [position, setPosition] = useState(null);
  const [showVoiceSettings, setShowVoiceSettings] = useState(false);
  const [micPermission, setMicPermission] = useState("unknown");

  const [editingPhone, setEditingPhone] = useState(!user?.phone);
  const [phoneDraft, setPhoneDraft] = useState(user?.phone || "");

  const [nearbyType, setNearbyType] = useState(null);
  const [nearbyPlaces, setNearbyPlaces] = useState([]);
  const [nearbyLoading, setNearbyLoading] = useState(false);
  const [nearbyError, setNearbyError] = useState("");
  const [nearbyCenter, setNearbyCenter] = useState(null);

  const recognitionRef = useRef(null);
  const shouldListenRef = useRef(false);
  const trackingRef = useRef(null);
  const statusPollRef = useRef(null);
  const sosActiveRef = useRef(false);
  const autoEnableAttemptedRef = useRef(false);
  // Speech callbacks are bound once when recognition starts, so they call
  // through a ref to always reach the current handler.
  const triggerRef = useRef(() => {});

  const voiceSupported =
    typeof window !== "undefined" &&
    Boolean(window.SpeechRecognition || window.webkitSpeechRecognition);

  const stopTimers = useCallback(() => {
    clearInterval(trackingRef.current);
    clearInterval(statusPollRef.current);
    trackingRef.current = null;
    statusPollRef.current = null;
  }, []);

  // The backend only updates coordinates on an open alert, so the trigger type
  // is carried through in case a ping ever has to recreate the row.
  const startLiveTracking = useCallback((triggerType) => {
    trackingRef.current = setInterval(async () => {
      try {
        const coords = await getCurrentPosition();
        setPosition({
          lat: coords.latitude,
          lon: coords.longitude,
          accuracy: coords.accuracy,
          updatedAt: Date.now(),
        });
        await sendSos({
          user_name: user?.name,
          phone: user?.phone,
          email: user?.email || "",
          trigger_type: triggerType,
          latitude: coords.latitude,
          longitude: coords.longitude,
        });
      } catch {
        // A single dropped ping is expected on a moving connection; the next
        // one carries the newest position.
      }
    }, TRACKING_INTERVAL_MS);
  }, [user?.email, user?.name, user?.phone]);

  const startStatusPolling = useCallback(() => {
    statusPollRef.current = setInterval(async () => {
      try {
        const data = await fetchAlertStatus(user?.phone);
        if (data?.status === "handled") {
          stopTimers();
          sosActiveRef.current = false;
          setPhase("handled");
          setNotice("The control room has closed your emergency.");
        }
      } catch {
        // Reachability is reported by the alert itself; keep polling.
      }
    }, STATUS_POLL_INTERVAL_MS);
  }, [stopTimers, user?.phone]);

  const triggerSOS = useCallback(async (triggerType = "Manual SOS") => {
    if (sosActiveRef.current) return;

    if (!user?.phone) {
      setEditingPhone(true);
    }

    sosActiveRef.current = true;
    setPhase("locating");
    setNotice("");

    try {
      const coords = await getCurrentPosition();
      setPosition({
        lat: coords.latitude,
        lon: coords.longitude,
        accuracy: coords.accuracy,
        updatedAt: Date.now(),
      });

      await sendSos({
        user_name: user?.name || "User",
        phone: user?.phone || "",
        email: user?.email || "",
        trigger_type: triggerType,
        latitude: coords.latitude,
        longitude: coords.longitude,
      });

      setPhase("sent");
      setNotice("Your location is being shared with the control room.");
      startLiveTracking(triggerType);
      startStatusPolling();
    } catch (error) {
      sosActiveRef.current = false;
      setPhase("failed");
      setNotice(
        error?.response?.data?.message ||
          error?.message ||
          "The alert could not be sent."
      );
    }
  }, [startLiveTracking, startStatusPolling, user]);

  useEffect(() => {
    triggerRef.current = triggerSOS;
  }, [triggerSOS]);

  const startListening = useCallback(() => {
    const SpeechRecognition =
      window.SpeechRecognition || window.webkitSpeechRecognition;

    if (!SpeechRecognition) {
      setNotice("Voice recognition is not supported in this browser.");
      return;
    }

    const recognition = new SpeechRecognition();
    recognition.continuous = true;
    recognition.interimResults = false;

    recognition.onresult = (event) => {
      const speech = event.results[event.results.length - 1][0].transcript
        .toLowerCase();

      if (TRIGGER_PHRASES.some((phrase) => speech.includes(phrase))) {
        // Named so the control room can tell a spoken alert from a pressed one.
        triggerRef.current("Voice Protection");
      }
    };

    recognition.onerror = (event) => {
      if (event.error === "not-allowed" || event.error === "service-not-allowed") {
        shouldListenRef.current = false;
        setListening(false);
        setMicPermission("denied");
        setNotice("Microphone access is blocked. Allow it to use voice protection.");
      }
    };

    // Continuous recognition still ends on its own after a pause. Restart only
    // while protection is meant to be on, otherwise stopping never sticks.
    recognition.onend = () => {
      if (shouldListenRef.current) {
        try {
          recognition.start();
        } catch {
          // Already restarting; nothing to do.
        }
        return;
      }

      setListening(false);
    };

    recognitionRef.current = recognition;
    shouldListenRef.current = true;
    setListening(true);
    setNotice("");
    recognition.start();
    setMicPermission("granted");
  }, []);

  const stopListening = useCallback(() => {
    shouldListenRef.current = false;

    if (recognitionRef.current) {
      recognitionRef.current.stop();
      recognitionRef.current = null;
    }

    setListening(false);
  }, []);

  // Reflects the actual permission state where the browser exposes it, so the
  // settings modal never shows a guess once the real value is known.
  useEffect(() => {
    if (!navigator.permissions?.query) return;

    let cancelled = false;

    navigator.permissions
      .query({ name: "microphone" })
      .then((result) => {
        if (cancelled) return;
        setMicPermission(result.state);
        result.onchange = () => setMicPermission(result.state);
      })
      .catch(() => {
        // Not every browser implements the "microphone" permission name.
      });

    return () => {
      cancelled = true;
    };
  }, []);

  // Starts listening once, only if the operator opted in from the settings
  // modal — never overrides an explicit tap on the card itself.
  useEffect(() => {
    if (
      voicePrefs.autoEnable &&
      voiceSupported &&
      micPermission !== "denied" &&
      !autoEnableAttemptedRef.current
    ) {
      autoEnableAttemptedRef.current = true;
      startListening();
    }
  }, [voicePrefs.autoEnable, voiceSupported, micPermission, startListening]);

  useEffect(() => {
    return () => {
      stopTimers();
      shouldListenRef.current = false;
      recognitionRef.current?.stop();
      recognitionRef.current = null;
    };
  }, [stopTimers]);

  const handleSavePhone = () => {
    const next = phoneDraft.trim();

    if (next.replace(/\D/g, "").length < 8) {
      setNotice("Enter a reachable phone number, including the area code.");
      return;
    }

    savePhone(next);
    setEditingPhone(false);
    setNotice("");
  };

  const phoneValid = phoneDraft.trim().replace(/\D/g, "").length >= 8;

  const loadNearbyPlaces = async (type) => {
    setNearbyType(type);
    setNearbyPlaces([]);
    setNearbyError("");
    setNearbyLoading(true);

    try {
      const coords = await getCurrentPosition();
      setNearbyCenter([coords.latitude, coords.longitude]);

      const amenity = type === "police" ? "police" : "hospital";
      const fallbackName = type === "police" ? "Police Station" : "Hospital";

      const query = `
        [out:json][timeout:25];
        (
          node["amenity"="${amenity}"](around:4000,${coords.latitude},${coords.longitude});
          way["amenity"="${amenity}"](around:4000,${coords.latitude},${coords.longitude});
          relation["amenity"="${amenity}"](around:4000,${coords.latitude},${coords.longitude});
        );
        out center;
      `;

      const response = await axios.get("https://overpass-api.de/api/interpreter", {
        params: { data: query },
      });

      const normalized = (response.data.elements || [])
        .map((item) => {
          const tags = item.tags || {};
          const latValue = item.lat ?? item.center?.lat;
          const lonValue = item.lon ?? item.center?.lon;

          if (!latValue || !lonValue) {
            return null;
          }

          const addressParts = [
            tags["addr:street"],
            tags["addr:city"],
            tags["addr:postcode"],
          ].filter(Boolean);

          return {
            id: `${item.type}-${item.id}`,
            name: tags.name || fallbackName,
            address: addressParts.join(", "),
            lat: latValue,
            lon: lonValue,
          };
        })
        .filter(Boolean)
        .slice(0, 12);

      setNearbyPlaces(normalized);
      if (!normalized.length) {
        setNearbyError("No nearby services were found within 4 km.");
      }
    } catch (error) {
      setNearbyError(
        error?.message || "Unable to load nearby services right now."
      );
    } finally {
      setNearbyLoading(false);
    }
  };

  const tracking = phase === "sent";

  const emergency = {
    idle: { text: "Idle", dot: "" },
    locating: { text: "Sending Alert", dot: "ks-dot--amber" },
    sent: { text: "Alert Sent", dot: "ks-dot--red" },
    handled: { text: "Help On The Way", dot: "ks-dot--green" },
    failed: { text: "Send Failed", dot: "ks-dot--red" },
  }[phase];

  const voice = tracking
    ? { text: "SOS Activated", dot: "ks-dot--red" }
    : listening
    ? { text: "Listening", dot: "ks-dot--green" }
    : { text: "Not Listening", dot: "" };

  const gps = position
    ? { text: "Location Found", dot: "ks-dot--green" }
    : { text: "Not Available", dot: "" };

  const nearbyLabel = { police: "Police", hospital: "Hospital" }[nearbyType] || "";

  if (user?.isAdmin) {
    return <Navigate to="/dashboard" replace />;
  }

  return (
    <div className="ks-home">
      <div className="ks-home__particles" aria-hidden="true">
        <i /><i /><i /><i /><i /><i />
      </div>

      <header className="ks-home__nav">
        <a className="ks-logo" href="/" style={{ marginBottom: 0, height: "auto" }}>
          <span className="ks-logo__mark"><ShieldAlert size={16} strokeWidth={2.1} /></span>
          <span className="ks-logo__text">Para<span>shu</span></span>
        </a>

        <div style={{ flex: 1 }} />

        {user?.isAdmin && (
          <a className="ks-btn ks-btn--ghost ks-btn--sm" href="/dashboard" title="Control room">
            <LayoutDashboard size={14} strokeWidth={1.9} />
          </a>
        )}

        <div className="ks-badge-police" title={user?.email}>
          {user?.avatar_url ? (
            <img className="ks-avatar ks-avatar--sm" src={user.avatar_url} alt="" referrerPolicy="no-referrer" />
          ) : (
            <span className="ks-avatar ks-avatar--sm ks-avatar--neutral">
              {String(user?.name || "?").trim().charAt(0).toUpperCase()}
            </span>
          )}
          <span className="ks-badge-police__id">
            <strong>{user?.name}</strong>
            <span>{user?.phone || user?.email}</span>
          </span>
        </div>

        <button
          className="ks-btn ks-btn--ghost ks-btn--sm"
          onClick={signOut}
          title="Logout"
        >
          <LogOut size={14} strokeWidth={1.9} />
        </button>
      </header>

      <main className="ks-home__main">

        {/* Voice Protection — the primary feature, always above SOS */}
        <div className={`ks-voicecard${listening ? " is-on" : " is-off"}`}>
          <div className="ks-voicecard__glow" aria-hidden="true" />

          <button
            type="button"
            className="ks-voicecard__gear"
            onClick={() => setShowVoiceSettings(true)}
            aria-label="Voice protection settings"
            title="Voice settings"
          >
            <SettingsIcon size={16} strokeWidth={1.9} />
          </button>

          <button
            type="button"
            className="ks-voicecard__hit"
            onClick={listening ? stopListening : startListening}
            aria-pressed={listening}
          >
            <span className="ks-voicecard__ring">
              <span className="ks-voicecard__pulse" aria-hidden="true" />
              {listening ? <Mic size={30} strokeWidth={1.8} /> : <MicOff size={30} strokeWidth={1.8} />}
            </span>

            <span className="ks-voicecard__status">
              {listening ? "Voice Protection ON" : "Voice Protection OFF"}
            </span>

            {listening ? (
              <>
                <VoiceWaveform />
                <span className="ks-voicecard__sub">Listening…</span>
                <span className="ks-voicecard__phrases">
                  {TRIGGER_PHRASES.map((phrase) => (
                    <span key={phrase}>{phrase}</span>
                  ))}
                </span>
              </>
            ) : (
              <span className="ks-voicecard__sub">Tap to enable hands-free SOS</span>
            )}

            <span className={`ks-voicecard__cta${listening ? " is-on" : ""}`}>
              {listening ? "Tap to disable" : "Enable Voice Protection"}
            </span>
          </button>
        </div>

        {/* SOS — directly below Voice Protection */}
        <button
          className="ks-sos"
          onClick={() => triggerSOS("Manual SOS")}
          disabled={phase === "locating"}
        >
          <span className="ks-sos__ripple" aria-hidden="true" />
          SOS
          <small>Send emergency alert</small>
        </button>

        {notice && <p className="ks-home__notice">{notice}</p>}

        <div className="ks-statusgrid">
          <div className="ks-statuscell">
            <span className="ks-statuscell__k">Voice</span>
            <span className="ks-statuscell__v"><span className={`ks-dot ${voice.dot}`} />{voice.text}</span>
          </div>
          <div className="ks-statuscell">
            <span className="ks-statuscell__k">GPS</span>
            <span className="ks-statuscell__v"><span className={`ks-dot ${gps.dot}`} />{gps.text}</span>
          </div>
          <div className="ks-statuscell">
            <span className="ks-statuscell__k">Emergency</span>
            <span className="ks-statuscell__v"><span className={`ks-dot ${emergency.dot}`} />{emergency.text}</span>
          </div>
        </div>

        <div className="ks-card">
          <div className="ks-card__head">
            <Phone size={15} strokeWidth={1.8} />
            <h2>Contact Number</h2>
            <span className={`ks-chip ${user?.phone ? "ks-chip--green" : "ks-chip--red"}`}>
              {user?.phone ? "Ready" : "Required"}
            </span>
          </div>
          <div className="ks-card__body">
            {editingPhone ? (
              <div className="ks-phonerow">
                <span className={`ks-searchwrap ${phoneDraft ? (phoneValid ? "is-valid" : "is-invalid") : ""}`}>
                  <Phone size={15} strokeWidth={1.8} />
                  <input
                    className="ks-input"
                    type="tel"
                    placeholder="Phone number responders can call"
                    value={phoneDraft}
                    onChange={(event) => setPhoneDraft(event.target.value)}
                    onKeyDown={(event) => {
                      if (event.key === "Enter") handleSavePhone();
                    }}
                  />
                  {phoneDraft && (phoneValid ? <Check size={15} strokeWidth={2} className="ks-inputok" /> : null)}
                </span>
                <button className="ks-btn" onClick={handleSavePhone} disabled={!phoneValid}>
                  <Check size={14} strokeWidth={2} /> Save
                </button>
              </div>
            ) : (
              <div className="ks-phonerow">
                <span className="ks-mono" style={{ fontSize: 15 }}>{user?.phone}</span>
                <button
                  className="ks-btn ks-btn--ghost ks-btn--sm"
                  onClick={() => {
                    setPhoneDraft(user?.phone || "");
                    setEditingPhone(true);
                  }}
                >
                  <Pencil size={13} strokeWidth={1.9} /> Change
                </button>
              </div>
            )}
            <p style={{ margin: "10px 0 0", fontSize: 12.5, color: "var(--muted)" }}>
              Sent with every alert so the control room can call you back. Stored
              on this device only.
            </p>
          </div>
        </div>

        <div className="ks-card">
          <div className="ks-card__head">
            <MapPin size={15} strokeWidth={1.8} />
            <h2>Live Location</h2>
            <span className={`ks-chip ${tracking ? "ks-chip--red" : "ks-chip--ghost"}`}>
              {tracking ? "Broadcasting" : position ? "Captured" : "Not shared"}
            </span>
          </div>
          <div className="ks-card__body">
            {position ? (
              <>
                <div className="ks-nearby-map">
                  <iframe
                    title="Your live location"
                    src={osmEmbedUrl(position.lat, position.lon)}
                  />
                </div>

                <div className="ks-geostats">
                  <div className="ks-geostats__item">
                    <span>Latitude</span>
                    <strong className="ks-mono">{position.lat.toFixed(6)}</strong>
                  </div>
                  <div className="ks-geostats__item">
                    <span>Longitude</span>
                    <strong className="ks-mono">{position.lon.toFixed(6)}</strong>
                  </div>
                  <div className="ks-geostats__item">
                    <span>Tracking</span>
                    <strong>{tracking ? "Live" : "Paused"}</strong>
                  </div>
                  <div className="ks-geostats__item">
                    <span>GPS accuracy</span>
                    <strong>{Number.isFinite(position.accuracy) ? `±${Math.round(position.accuracy)} m` : "—"}</strong>
                  </div>
                  <div className="ks-geostats__item ks-geostats__item--wide">
                    <span><Clock size={11} strokeWidth={2} /> Last updated</span>
                    <strong>{position.updatedAt ? new Date(position.updatedAt).toLocaleTimeString() : "—"}</strong>
                  </div>
                </div>

                <div className="ks-actions" style={{ marginTop: 12 }}>
                  <a className="ks-btn" href={googleMapsUrl(position.lat, position.lon)} target="_blank" rel="noreferrer">
                    <ExternalLink size={14} strokeWidth={1.9} /> Google Maps
                  </a>
                  <a className="ks-btn ks-btn--ghost" href={osmLinkUrl(position.lat, position.lon)} target="_blank" rel="noreferrer">
                    <Navigation size={14} strokeWidth={1.9} /> OpenStreetMap
                  </a>
                </div>
              </>
            ) : (
              <p style={{ margin: 0, fontSize: 12.5, color: "var(--muted)" }}>
                Shared automatically when an alert is sent.
              </p>
            )}
          </div>
        </div>

        <div className="ks-safety">
          <h3 className="ks-safety__title">Safety Resources</h3>

          <div className="ks-nearby-grid">
            <button
              type="button"
              className={`ks-nearby-card ${nearbyType === "police" ? "is-active" : ""}`}
              onClick={() => loadNearbyPlaces("police")}
            >
              <span className="ks-nearby-card__icon">
                <ShieldAlert size={18} strokeWidth={1.8} />
              </span>
              <span className="ks-nearby-card__text">
                <strong>Nearby Police</strong>
                <span>Find stations near you</span>
              </span>
            </button>

            <button
              type="button"
              className={`ks-nearby-card ${nearbyType === "hospital" ? "is-active" : ""}`}
              onClick={() => loadNearbyPlaces("hospital")}
            >
              <span className="ks-nearby-card__icon">
                <Hospital size={18} strokeWidth={1.8} />
              </span>
              <span className="ks-nearby-card__text">
                <strong>Nearby Hospitals</strong>
                <span>Find medical help nearby</span>
              </span>
            </button>

          </div>
        </div>

        {nearbyLoading ? (
          <div className="ks-card">
            <div className="ks-card__body">
              <div className="ks-empty ks-empty--compact">
                <h3>Finding nearby services…</h3>
                <p>Using your location and OpenStreetMap data to build a local list.</p>
              </div>
            </div>
          </div>
        ) : null}

        {!nearbyLoading && nearbyError ? (
          <div className="ks-card">
            <div className="ks-card__body">
              <div className="ks-empty ks-empty--compact">
                <h3>{nearbyError}</h3>
                <p>Try again after allowing location permission.</p>
              </div>
            </div>
          </div>
        ) : null}

        {!nearbyLoading && nearbyPlaces.length > 0 ? (
          <div className="ks-card">
            <div className="ks-card__body">
              {nearbyCenter ? (
                <div className="ks-nearby-map">
                  <iframe
                    title={`${nearbyLabel} map`}
                    src={osmEmbedUrl(nearbyCenter[0], nearbyCenter[1], 0.02)}
                  />
                </div>
              ) : null}
              <ul className="ks-nearby-list">
                {nearbyPlaces.map((place) => (
                  <li className="ks-nearby-item" key={place.id}>
                    <span className="ks-nearby-item__icon">
                      <Crosshair size={14} strokeWidth={1.9} />
                    </span>
                    <div>
                      <strong>{place.name}</strong>
                      <span>{place.address || "Nearby service"}</span>
                    </div>
                    <a
                      className="ks-btn ks-btn--ghost ks-btn--sm"
                      href={osmLinkUrl(place.lat, place.lon)}
                      target="_blank"
                      rel="noreferrer"
                    >
                      <MapPin size={13} strokeWidth={1.9} /> Map
                    </a>
                  </li>
                ))}
              </ul>
            </div>
          </div>
        ) : null}

        <p className="ks-home__foot">
          Press <kbd>SOS</kbd> or say <kbd>HELP ME</kbd>
        </p>
      </main>

      {showVoiceSettings && (
        <VoiceSettingsModal
          prefs={voicePrefs}
          setSensitivity={setSensitivity}
          setAutoEnable={setAutoEnable}
          micPermission={micPermission}
          voiceSupported={voiceSupported}
          onClose={() => setShowVoiceSettings(false)}
        />
      )}
    </div>
  );
}
