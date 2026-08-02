import { useState, useRef } from "react";
import axios from "axios";
import { signOutUser } from "./lib/supabaseClient";
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
} from "lucide-react";

export default function Home() {
  const user = JSON.parse(localStorage.getItem("user") || "null");
  const [status, setStatus] = useState("Ready");
  const [listening, setListening] = useState(false);
  const [mapLink, setMapLink] = useState("");
  const [nearbyType, setNearbyType] = useState(null);
  const [nearbyPlaces, setNearbyPlaces] = useState([]);
  const [nearbyLoading, setNearbyLoading] = useState(false);
  const [nearbyError, setNearbyError] = useState("");
  const [nearbyCenter, setNearbyCenter] = useState(null);
  const recognitionRef = useRef(null);
  const trackingRef = useRef(null);
  const statusCheckRef = useRef(null);
  const sosActiveRef = useRef(false);

  const startListening = () => {
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;

    if (!SpeechRecognition) {
      alert("Speech recognition not supported");
      return;
    }

    const recognition = new SpeechRecognition();

    recognition.continuous = true;
    recognition.interimResults = false;

    recognitionRef.current = recognition;

    setListening(true);
    setStatus("Voice protection active");

    recognition.onresult = (event) => {
      const speech = event.results[event.results.length - 1][0].transcript.toLowerCase();

      if (speech.includes("help me") || speech.includes("sos")) {
        triggerSOS();
      }
    };

    recognition.onend = () => {
      if (recognitionRef.current) {
        recognitionRef.current.start();
      }
    };

    recognition.start();
  };

  const stopListening = () => {
    setListening(false);

    if (recognitionRef.current) {
      recognitionRef.current.stop();
    }

    setStatus("Voice protection stopped");
  };

  const triggerSOS = () => {
    if (sosActiveRef.current) return;
    sosActiveRef.current = true;

    setStatus("Getting location...");

    navigator.geolocation.getCurrentPosition(async (pos) => {
      const lat = pos.coords.latitude;
      const lon = pos.coords.longitude;

      const mapURL = `https://maps.google.com/?q=${lat},${lon}`;
      setMapLink(mapURL);

      try {
        await axios.post("https://kalisos-backend.onrender.com/sos", {
          user_name: user?.name,
          phone: user?.phone,
          email: user?.email || "",
          trigger_type: "Manual SOS",
          latitude: lat,
          longitude: lon,
        });

        setStatus("🚨 SOS Alert Sent");
        startLiveTracking();
        checkIfHandled();
      } catch {
        setStatus("Error sending alert");
      }
    });
  };

  const startLiveTracking = () => {
    trackingRef.current = setInterval(() => {
      navigator.geolocation.getCurrentPosition(async (pos) => {
        const lat = pos.coords.latitude;
        const lon = pos.coords.longitude;

        try {
          await axios.post("https://kalisos-backend.onrender.com/sos", {
            user_name: user?.name,
            phone: user?.phone,
            email: user?.email || "",
            trigger_type: "Manual SOS",
            latitude: lat,
            longitude: lon,
          });
        } catch {
          console.log("Tracking error");
        }
      });
    }, 5000);
  };

  const checkIfHandled = () => {
    statusCheckRef.current = setInterval(async () => {
      try {
        const res = await axios.get(`https://kalisos-backend.onrender.com/alert-status/${user?.phone}`);
        if (res.data.status === "handled") {
          clearInterval(trackingRef.current);
          clearInterval(statusCheckRef.current);

          sosActiveRef.current = false;

          setStatus("Emergency handled by authorities");
        }
      } catch {
        console.log("Status check failed");
      }
    }, 3000);
  };

  const loadNearbyPlaces = (type) => {
    if (!navigator.geolocation) {
      setNearbyError("Location access is not supported on this device.");
      return;
    }

    setNearbyType(type);
    setNearbyPlaces([]);
    setNearbyError("");
    setNearbyLoading(true);

    navigator.geolocation.getCurrentPosition(
      async (position) => {
        const lat = position.coords.latitude;
        const lon = position.coords.longitude;
        setNearbyCenter([lat, lon]);

        const amenity = type === "police" ? "police" : "hospital";
        const query = `
          [out:json][timeout:25];
          (
            node["amenity"="${amenity}"](around:4000,${lat},${lon});
            way["amenity"="${amenity}"](around:4000,${lat},${lon});
            relation["amenity"="${amenity}"](around:4000,${lat},${lon});
          );
          out center;
        `;

        try {
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

              const addressParts = [tags["addr:street"], tags["addr:city"], tags["addr:postcode"]].filter(Boolean);

              return {
                id: `${item.type}-${item.id}`,
                name: tags.name || (type === "police" ? "Police Station" : "Hospital"),
                address: addressParts.join(", "),
                lat: latValue,
                lon: lonValue,
              };
            })
            .filter(Boolean)
            .slice(0, 12);

          setNearbyPlaces(normalized);
          if (!normalized.length) {
            setNearbyError("No nearby services were found in the selected radius.");
          }
        } catch {
          setNearbyError("Unable to load nearby services right now. Please try again.");
        } finally {
          setNearbyLoading(false);
        }
      },
      () => {
        setNearbyError("Please allow location access to find nearby services.");
        setNearbyLoading(false);
      },
      { enableHighAccuracy: true, timeout: 10000 }
    );
  };

  const sent = status.includes("SOS Alert Sent");
  const sending = status.includes("Getting location");
  const handled = status.includes("handled");
  const failed = status.includes("Error");
  const tracking = sent && !handled;

  const emergency = handled
    ? { text: "Help On The Way", dot: "ks-dot--green" }
    : failed
    ? { text: "Send Failed", dot: "ks-dot--red" }
    : sent
    ? { text: "Alert Sent", dot: "ks-dot--red" }
    : sending
    ? { text: "Sending Alert", dot: "ks-dot--amber" }
    : { text: "Idle", dot: "" };

  const voice = sent
    ? { text: "SOS Activated", dot: "ks-dot--red" }
    : listening
    ? { text: "Listening", dot: "ks-dot--green" }
    : { text: "Not Listening", dot: "" };

  const gps = mapLink
    ? { text: "Location Found", dot: "ks-dot--green" }
    : { text: "Not Available", dot: "" };

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

        <a className="ks-btn ks-btn--ghost ks-btn--sm" href="/dashboard" title="Control room">
          <LayoutDashboard size={14} strokeWidth={1.9} />
        </a>

        <div className="ks-badge-police" title={user?.phone}>
          <span className="ks-avatar ks-avatar--sm ks-avatar--neutral">
            {String(user?.name || "?").trim().charAt(0).toUpperCase()}
          </span>
          <span className="ks-badge-police__id">
            <strong>{user?.name}</strong>
            <span>{user?.phone}</span>
          </span>
        </div>

        <button
          className="ks-btn ks-btn--ghost ks-btn--sm"
          onClick={async () => {
            await signOutUser();
            window.location.reload();
          }}
          title="Logout"
        >
          <LogOut size={14} strokeWidth={1.9} />
        </button>
      </header>

      <main className="ks-home__main">
        <button className="ks-sos" onClick={triggerSOS}>
          SOS
          <small>Send emergency alert</small>
        </button>

        <button
          className={`ks-voice ${listening ? "is-on" : ""}`}
          onClick={listening ? stopListening : startListening}
        >
          <span className="ks-voice__ring">
            {listening ? <Mic size={24} strokeWidth={1.7} /> : <MicOff size={24} strokeWidth={1.7} />}
          </span>
          <span className="ks-voice__text">
            <strong>{listening ? "Voice Protection On" : "Voice Protection Off"}</strong>
            <span>{listening ? "Listening for “help me”" : "Tap to activate hands free SOS"}</span>
          </span>
        </button>

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
            <MapPin size={15} strokeWidth={1.8} />
            <h2>Live Location</h2>
            <span className={`ks-chip ${tracking ? "ks-chip--red" : "ks-chip--ghost"}`}>
              {tracking ? "Broadcasting" : mapLink ? "Captured" : "Not shared"}
            </span>
          </div>
          <div className="ks-card__body">
            {mapLink ? (
              <div className="ks-actions">
                <a className="ks-btn" href={mapLink} target="_blank" rel="noreferrer">
                  <ExternalLink size={14} strokeWidth={1.9} /> Google Maps
                </a>
                <a className="ks-btn ks-btn--ghost" href={mapLink} target="_blank" rel="noreferrer">
                  <Navigation size={14} strokeWidth={1.9} /> Share position
                </a>
              </div>
            ) : (
              <p style={{ margin: 0, fontSize: 12.5, color: "var(--muted)" }}>
                Shared automatically when an alert is sent.
              </p>
            )}
          </div>
        </div>

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
                    title={`${nearbyType === "police" ? "Police" : "Hospital"} map`}
                    src={`https://www.openstreetmap.org/export/embed.html?bbox=${nearbyCenter[1] - 0.02},${nearbyCenter[0] - 0.02},${nearbyCenter[1] + 0.02},${nearbyCenter[0] + 0.02}&layer=mapnik&marker=${nearbyCenter[0]},${nearbyCenter[1]}`}
                  />
                </div>
              ) : null}
              <ul className="ks-nearby-list">
                {nearbyPlaces.map((place) => (
                  <li className="ks-nearby-item" key={place.id}>
                    <div>
                      <strong>{place.name}</strong>
                      <span>{place.address || "Nearby service"}</span>
                    </div>
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
    </div>
  );
}
