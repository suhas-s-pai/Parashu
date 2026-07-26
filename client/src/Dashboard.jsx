import { useEffect, useState } from "react";
import axios from "axios";
import {
  Siren,
  CheckCircle2,
  Timer,
  Users,
  Satellite,
  Activity,
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
} from "lucide-react";
import CommandShell from "./CommandShell";

const siren = new Audio("/siren.mp3");
siren.loop = true;
siren.preload = "auto";

/* ---------- presentation helpers (no API or state involvement) ---------- */

// Priority is derived from how long the caller has been waiting. It is a
// display heuristic, not a value the backend assigns.
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

// Great-circle distance, used only when the operator has pinned the control
// room position. Returns null otherwise rather than inventing a number.
function distanceKm(origin, lat, lon) {
  if (!origin) return null;
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
  const bbox = [lon - span, lat - span * 0.75, lon + span, lat + span * 0.75].join(",");
  return `https://www.openstreetmap.org/export/embed.html?bbox=${bbox}&layer=mapnik&marker=${lat},${lon}`;
}

export default function Dashboard({ focus }) {

  const [alerts, setAlerts] = useState([]);
  const [lastAlertCount, setLastAlertCount] = useState(0);

 useEffect(() => {

  // unlock audio
  document.body.addEventListener("click", () => {
    siren.play().then(()=>siren.pause()).catch(()=>{});
  }, { once: true });

  fetchAlerts();

  const interval = setInterval(() => {
    fetchAlerts();
  }, 2000);

  return () => clearInterval(interval);

}, []);

const fetchAlerts = async () => {

const res = await axios.get("https://kalisos-backend.onrender.com/alerts");

if(res.data.length > lastAlertCount){

  siren.currentTime = 0;
  siren.play().catch(()=>{});

  setTimeout(()=>{
    siren.pause();
    siren.currentTime = 0;
  },1000);

}

setLastAlertCount(res.data.length);
setAlerts(res.data);

};

  const handleAlert = async (id) => {

  await axios.delete(`https://kalisos-backend.onrender.com/alerts/${id}`);

  fetchAlerts();

};

  /* ---------- view-only additions ---------- */

  const [selectedId, setSelectedId] = useState(null);
  const [copiedId, setCopiedId] = useState(null);
  const [origin, setOrigin] = useState(null);

  const feedOnly = focus === "feed";

  const selected =
    alerts.find((a) => a.id === selectedId) || alerts[0] || null;

  const uniqueDevices = new Set(alerts.map((a) => a.phone)).size;

  const copyCoordinates = async (alert) => {
    const text = `${alert.latitude}, ${alert.longitude}`;
    try {
      await navigator.clipboard.writeText(text);
      setCopiedId(alert.id);
      setTimeout(() => setCopiedId(null), 1500);
    } catch {
      window.prompt("Copy coordinates", text);
    }
  };

  const playSiren = () => {
    siren.currentTime = 0;
    siren.play().catch(() => {});
    setTimeout(() => {
      siren.pause();
      siren.currentTime = 0;
    }, 2500);
  };

  const pinControlRoom = () => {
    navigator.geolocation.getCurrentPosition(
      (pos) => setOrigin({ lat: pos.coords.latitude, lon: pos.coords.longitude }),
      () => setOrigin(null)
    );
  };

  /* ---------- pieces ---------- */

  const statsRow = (
    <section className="ks-stats">

      <article className="ks-stat ks-stat--red">
        <div className="ks-stat__top"><Siren size={15} strokeWidth={1.8} /><span>Active Alerts</span></div>
        <p className="ks-stat__value">{alerts.length}</p>
        <p className="ks-stat__meta">Awaiting response</p>
      </article>

      <article className="ks-stat ks-stat--muted">
        <div className="ks-stat__top"><CheckCircle2 size={15} strokeWidth={1.8} /><span>Handled Today</span></div>
        <p className="ks-stat__value ks-pending">—</p>
        <p className="ks-stat__meta">Needs a resolved-alerts endpoint</p>
      </article>

      <article className="ks-stat ks-stat--muted">
        <div className="ks-stat__top"><Timer size={15} strokeWidth={1.8} /><span>Avg Response Time</span></div>
        <p className="ks-stat__value ks-pending">—</p>
        <p className="ks-stat__meta">Needs handled_at timestamps</p>
      </article>

      <article className="ks-stat ks-stat--muted">
        <div className="ks-stat__top"><Users size={15} strokeWidth={1.8} /><span>Officers Online</span></div>
        <p className="ks-stat__value ks-pending">—</p>
        <p className="ks-stat__meta">Needs officer presence service</p>
      </article>

      <article className="ks-stat ks-stat--green">
        <div className="ks-stat__top"><Satellite size={15} strokeWidth={1.8} /><span>Live GPS Devices</span></div>
        <p className="ks-stat__value">{uniqueDevices}</p>
        <p className="ks-stat__meta">Distinct handsets transmitting</p>
      </article>

      <article className="ks-stat">
        <div className="ks-stat__top"><Activity size={15} strokeWidth={1.8} /><span>Alert Feed</span></div>
        <p className="ks-stat__value ks-stat__value--sm">Polling · 2s</p>
        <p className="ks-stat__meta">Live connection status in top bar</p>
      </article>

    </section>
  );

  const feed = (
    <section>

      <div className="ks-sectionhead">
        <h2>Live Emergency Feed</h2>
        <span className="ks-chip ks-chip--ghost">{alerts.length} open</span>
        <div className="ks-sectionhead__spacer" />
        <button
          className="ks-btn ks-btn--ghost ks-btn--sm"
          onClick={pinControlRoom}
          title="Use this browser's location as the control room origin to compute distances"
        >
          <Crosshair size={14} strokeWidth={1.8} />
          {origin ? "Origin pinned" : "Pin control room"}
        </button>
      </div>

      <div className="ks-feed">

        {alerts.length === 0 && (
          <div className="ks-card">
            <div className="ks-empty">
              <CheckCircle2 size={22} strokeWidth={1.6} />
              <h3>No active emergencies</h3>
              <p>The channel is monitored continuously. Incoming alerts appear here within two seconds.</p>
            </div>
          </div>
        )}

        {alerts.map((alert) => {
          const priority = priorityOf(alert.created_at);
          const distance = distanceKm(origin, Number(alert.latitude), Number(alert.longitude));

          return (
            <article
              className={`ks-alert ${priority.cls}${selected && selected.id === alert.id ? " is-selected" : ""}`}
              key={alert.id}
              onClick={() => setSelectedId(alert.id)}
            >

              <header className="ks-alert__head">

                <span className="ks-avatar">
                  {String(alert.user_name || "?").trim().charAt(0).toUpperCase()}
                </span>

                <div className="ks-alert__id">
                  <h3>{alert.user_name}</h3>
                  <div className="ks-alert__sub">
                    <a href={`tel:${alert.phone}`} onClick={(e) => e.stopPropagation()}>
                      <Phone size={12} strokeWidth={1.9} />
                      {alert.phone}
                    </a>
                    <span><Clock size={12} strokeWidth={1.9} style={{ verticalAlign: -2, marginRight: 4 }} />
                      {new Date(alert.created_at).toLocaleString("en-IN", {
                        day: "2-digit", month: "short", hour: "numeric", minute: "2-digit", hour12: true,
                      })}
                    </span>
                  </div>
                </div>

                <span className={`ks-chip ${priority.chip}`}>{priority.level} · {priority.label}</span>

              </header>

              <div className="ks-alert__badges">
                <span className="ks-chip ks-chip--red">
                  <span className="ks-dot ks-dot--red" /> SOS Active
                </span>
                <span className="ks-chip ks-chip--ghost" title="The API does not record whether the alert came from the SOS button or a voice phrase">
                  <Mic size={11} strokeWidth={2} /> Trigger not recorded
                </span>
                <span className="ks-chip ks-chip--ghost" title="Handset battery is not transmitted by the client">
                  Battery n/a
                </span>
                <span className="ks-chip ks-chip--ghost">
                  <Radio size={11} strokeWidth={2} /> {elapsedSince(alert.created_at)} elapsed
                </span>
              </div>

              <div className="ks-grid2">
                <div className="ks-kv">
                  <div className="ks-kv__k"><MapPin size={10} strokeWidth={2.2} /> Latitude</div>
                  <div className="ks-kv__v">{alert.latitude}</div>
                </div>
                <div className="ks-kv">
                  <div className="ks-kv__k"><MapPin size={10} strokeWidth={2.2} /> Longitude</div>
                  <div className="ks-kv__v">{alert.longitude}</div>
                </div>
                <div className="ks-kv">
                  <div className="ks-kv__k"><Navigation size={10} strokeWidth={2.2} /> Distance</div>
                  <div className={`ks-kv__v${distance === null ? " ks-pending" : ""}`}>
                    {distance === null ? "pin origin" : `${distance.toFixed(2)} km`}
                  </div>
                </div>
              </div>

              <div className="ks-actions" onClick={(e) => e.stopPropagation()}>

                <a
                  className="ks-btn ks-btn--sm"
                  href={`https://maps.google.com/?q=${alert.latitude},${alert.longitude}`}
                  target="_blank"
                  rel="noreferrer"
                >
                  <ExternalLink size={14} strokeWidth={1.9} /> Open Maps
                </a>

                <button className="ks-btn ks-btn--ghost ks-btn--sm" onClick={() => copyCoordinates(alert)}>
                  {copiedId === alert.id
                    ? <><Check size={14} strokeWidth={2.2} /> Copied</>
                    : <><Copy size={14} strokeWidth={1.9} /> Coordinates</>}
                </button>

                <a className="ks-btn ks-btn--ghost ks-btn--sm" href={`tel:${alert.phone}`}>
                  <Phone size={14} strokeWidth={1.9} /> Call
                </a>

                <button className="ks-btn ks-btn--ghost ks-btn--sm" onClick={playSiren}>
                  <Volume2 size={14} strokeWidth={1.9} /> Siren
                </button>

                <button
                  className="ks-btn ks-btn--success ks-btn--sm"
                  onClick={() => handleAlert(alert.id)}
                >
                  <Check size={14} strokeWidth={2.2} /> Handle Alert
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
          <MapPin size={15} strokeWidth={1.8} />
          <h2>Live Position</h2>
          {selected && <span className="ks-chip ks-chip--red"><span className="ks-dot ks-dot--red" /> Tracking</span>}
        </div>

        {selected ? (
          <>
            <div className="ks-mapwrap">
              <iframe
                className="ks-map"
                title="Live emergency position"
                src={osmEmbed(Number(selected.latitude), Number(selected.longitude))}
                loading="lazy"
              />
            </div>

            <div className="ks-card__body" style={{ display: "grid", gap: 10 }}>

              <div className="ks-list">
                <div className="ks-list__row"><span style={{ color: "var(--muted)" }}>Caller</span><b>{selected.user_name}</b></div>
                <div className="ks-list__row"><span style={{ color: "var(--muted)" }}>Latitude</span><b>{selected.latitude}</b></div>
                <div className="ks-list__row"><span style={{ color: "var(--muted)" }}>Longitude</span><b>{selected.longitude}</b></div>
                <div className="ks-list__row">
                  <span style={{ color: "var(--muted)" }}>Nearest station</span>
                  <b className="ks-pending">not connected</b>
                </div>
              </div>

              <div className="ks-actions">
                <a
                  className="ks-btn ks-btn--sm"
                  href={`https://www.google.com/maps/dir/?api=1&destination=${selected.latitude},${selected.longitude}`}
                  target="_blank"
                  rel="noreferrer"
                >
                  <Navigation size={14} strokeWidth={1.9} /> Navigate
                </a>
                <a
                  className="ks-btn ks-btn--ghost ks-btn--sm"
                  href={`https://www.google.com/maps/search/police+station/@${selected.latitude},${selected.longitude},14z`}
                  target="_blank"
                  rel="noreferrer"
                >
                  <Building2 size={14} strokeWidth={1.9} /> Find station
                </a>
              </div>

            </div>
          </>
        ) : (
          <div className="ks-empty">
            <MapPin size={22} strokeWidth={1.6} />
            <h3>No position to track</h3>
            <p>Select an alert to plot the caller's live coordinates.</p>
          </div>
        )}

      </div>
    </aside>
  );

  return (
    <CommandShell
      title={feedOnly ? "Live Alerts" : "Emergency Operations"}
      alertCount={alerts.length}
      syncLabel="Live · 2s"
      syncLive
    >
      {!feedOnly && statsRow}
      {feedOnly ? feed : <div className="ks-split">{feed}{mapPanel}</div>}
    </CommandShell>
  );
}
