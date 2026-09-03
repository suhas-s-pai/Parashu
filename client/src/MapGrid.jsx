import { useEffect, useState } from "react";
import { fetchActiveAlerts } from "./lib/api";
import { normalizeAlert } from "./lib/alerts";
import {
  Search,
  Layers,
  MapPin,
  Navigation,
  Building2,
  Satellite,
  Signal,
  Crosshair,
} from "lucide-react";
import CommandShell from "./CommandShell";

// OpenStreetMap's embed endpoint needs no API key. These layers are real and
// switch the rendered tiles; satellite and traffic are not offered by it.
const LAYERS = [
  { id: "mapnik", label: "Standard" },
  { id: "cyclemap", label: "Cycle" },
  { id: "transportmap", label: "Transport" },
  { id: "hot", label: "Humanitarian" },
];

export default function MapGrid() {
  const [alerts, setAlerts] = useState([]);
  const [query, setQuery] = useState("");
  const [layer, setLayer] = useState("mapnik");
  const [selectedId, setSelectedId] = useState(null);
  const [span, setSpan] = useState(0.012);

  useEffect(() => {
    let cancelled = false;

    const load = async () => {
      try {
        const data = await fetchActiveAlerts();
        if (!cancelled) setAlerts(data.map(normalizeAlert));
      } catch {
        /* the top bar reports reachability */
      }
    };

    load();
    const timer = setInterval(load, 5000);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, []);

  const term = query.trim().toLowerCase();
  const pins = term
    ? alerts.filter(
        (a) =>
          String(a.user_name || "").toLowerCase().includes(term) ||
          String(a.phone || "").includes(term) ||
          `${a.latitude},${a.longitude}`.includes(term)
      )
    : alerts;

  const selected = pins.find((a) => a.id === selectedId) || pins[0] || null;

  const lat = selected ? Number(selected.latitude) : 20.5937;
  const lon = selected ? Number(selected.longitude) : 78.9629;
  const viewSpan = selected ? span : 12;

  const bbox = [
    lon - viewSpan,
    lat - viewSpan * 0.7,
    lon + viewSpan,
    lat + viewSpan * 0.7,
  ].join(",");

  const src =
    `https://www.openstreetmap.org/export/embed.html?bbox=${bbox}&layer=${layer}` +
    (selected ? `&marker=${lat},${lon}` : "");

  const nearby = (kind) =>
    `https://www.google.com/maps/search/${kind}/@${lat},${lon},14z`;

  return (
    <CommandShell
      title="Map Grid"
      alertCount={alerts.length}
      syncLabel="Live · 5s"
      syncLive
    >

      <div className="ks-split ks-map-grid">

        <div className="ks-card">

          <div className="ks-toolbar">
            <div className="ks-searchwrap">
              <Search size={15} strokeWidth={1.8} />
              <input
                className="ks-input"
                placeholder="Search name, phone or coordinates"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
              />
            </div>

            <select
              className="ks-select"
              style={{ width: "auto" }}
              value={layer}
              onChange={(e) => setLayer(e.target.value)}
            >
              {LAYERS.map((l) => (
                <option key={l.id} value={l.id}>{l.label} layer</option>
              ))}
            </select>

            <button
              className="ks-btn ks-btn--ghost ks-btn--sm"
              onClick={() => setSpan((s) => Math.max(0.002, s / 2))}
              disabled={!selected}
              title="Zoom in"
            >
              +
            </button>
            <button
              className="ks-btn ks-btn--ghost ks-btn--sm"
              onClick={() => setSpan((s) => Math.min(1, s * 2))}
              disabled={!selected}
              title="Zoom out"
            >
              −
            </button>

            <span className="ks-chip ks-chip--ghost" title="Not available through the keyless OSM embed">
              <Satellite size={12} strokeWidth={2} /> Satellite n/a
            </span>
            <span className="ks-chip ks-chip--ghost" title="Requires a routing/traffic tile provider">
              <Signal size={12} strokeWidth={2} /> Traffic n/a
            </span>
          </div>

          <div className="ks-mapwrap">
            <iframe
              className="ks-map ks-map--tall"
              title="Emergency map grid"
              src={src}
              loading="lazy"
            />
          </div>

          <div className="ks-maplegend">
            <span><span className="ks-dot ks-dot--red" /> Active SOS</span>
            <span><span className="ks-dot ks-dot--blue" /> Selected pin</span>
            <span><span className="ks-dot ks-dot--green" /> Safe zone <em className="ks-pending">(layer not connected)</em></span>
            <span><span className="ks-dot ks-dot--amber" /> Station <em className="ks-pending">(layer not connected)</em></span>
          </div>

        </div>

        <div style={{ display: "grid", gap: 16 }}>

          <div className="ks-card">
            <div className="ks-card__head">
              <MapPin size={15} strokeWidth={1.8} />
              <h2>SOS Pins</h2>
              <span className="ks-chip ks-chip--ghost">{pins.length}</span>
            </div>

            {pins.length === 0 ? (
              <div className="ks-empty">
                <h3>No pins</h3>
                <p>{alerts.length ? "No alert matches this search." : "No active alerts to plot."}</p>
              </div>
            ) : (
              <div className="ks-contacts">
                {pins.map((a) => (
                  <button
                    className="ks-contact"
                    key={a.id}
                    onClick={() => setSelectedId(a.id)}
                    style={{
                      background: selected && selected.id === a.id ? "rgba(37,99,235,.12)" : undefined,
                      border: "none",
                      borderBottom: "1px solid var(--line)",
                      width: "100%",
                      cursor: "pointer",
                      textAlign: "left",
                    }}
                  >
                    <span className="ks-avatar ks-avatar--sm">
                      {String(a.user_name || "?").trim().charAt(0).toUpperCase()}
                    </span>
                    <span className="ks-contact__text">
                      <strong>{a.user_name}</strong>
                      <span className="ks-mono">
                        {Number(a.latitude).toFixed(4)}, {Number(a.longitude).toFixed(4)}
                      </span>
                    </span>
                    <Crosshair size={14} strokeWidth={1.8} style={{ color: "var(--muted)" }} />
                  </button>
                ))}
              </div>
            )}
          </div>

          <div className="ks-card">
            <div className="ks-card__head">
              <Layers size={15} strokeWidth={1.8} />
              <h2>Facilities Near Pin</h2>
            </div>
            <div className="ks-card__body" style={{ display: "grid", gap: 8 }}>
              <a className="ks-btn ks-btn--ghost" href={nearby("police+station")} target="_blank" rel="noreferrer">
                <Building2 size={14} strokeWidth={1.9} /> Police stations
              </a>
              <a className="ks-btn ks-btn--ghost" href={nearby("hospital")} target="_blank" rel="noreferrer">
                <Building2 size={14} strokeWidth={1.9} /> Hospitals
              </a>
              <a className="ks-btn ks-btn--ghost" href={nearby("fire+station")} target="_blank" rel="noreferrer">
                <Building2 size={14} strokeWidth={1.9} /> Fire stations
              </a>
              {selected && (
                <a
                  className="ks-btn"
                  href={`https://www.google.com/maps/dir/?api=1&destination=${lat},${lon}`}
                  target="_blank"
                  rel="noreferrer"
                >
                  <Navigation size={14} strokeWidth={1.9} /> Navigate to pin
                </a>
              )}
            </div>
          </div>

          <div className="ks-card">
            <div className="ks-card__head">
              <Signal size={15} strokeWidth={1.8} />
              <h2>GPS Status</h2>
            </div>
            <div className="ks-list" style={{ padding: "0 16px" }}>
              <div className="ks-list__row"><span style={{ color: "var(--muted)" }}>Pins plotted</span><b>{pins.length}</b></div>
              <div className="ks-list__row"><span style={{ color: "var(--muted)" }}>Latitude</span><b>{selected ? lat.toFixed(6) : "—"}</b></div>
              <div className="ks-list__row"><span style={{ color: "var(--muted)" }}>Longitude</span><b>{selected ? lon.toFixed(6) : "—"}</b></div>
              <div className="ks-list__row">
                <span style={{ color: "var(--muted)" }}>District / Zone</span>
                <b className="ks-pending">not mapped</b>
              </div>
            </div>
          </div>

        </div>

      </div>

    </CommandShell>
  );
}
