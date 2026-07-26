import { useEffect, useState } from "react";
import axios from "axios";
import {
  BarChart3,
  Clock,
  MapPin,
  Timer,
  CheckCircle2,
  TrendingUp,
  Flame,
  Info,
} from "lucide-react";
import CommandShell from "./CommandShell";

/**
 * Analytics over the live alert feed.
 *
 * GET /alerts only returns alerts that are still active, so anything
 * historical — daily/weekly/monthly totals, response times, resolution rate —
 * cannot be computed here. Those panels state what they need rather than
 * displaying invented figures.
 */
export default function Insights() {
  const [alerts, setAlerts] = useState([]);
  const [loaded, setLoaded] = useState(false);
  // Captured when data arrives so the render stays pure.
  const [sampledAt, setSampledAt] = useState(() => Date.now());

  useEffect(() => {
    let cancelled = false;

    const load = async () => {
      try {
        const res = await axios.get("https://kalisos-backend.onrender.com/alerts");
        if (!cancelled) {
          setAlerts(res.data);
          setSampledAt(Date.now());
          setLoaded(true);
        }
      } catch {
        if (!cancelled) setLoaded(true);
      }
    };

    load();
    const timer = setInterval(load, 10000);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, []);

  // Distribution of currently-open alerts across the 24h clock.
  const byHour = Array.from({ length: 24 }, () => 0);
  alerts.forEach((a) => {
    const hour = new Date(a.created_at).getHours();
    if (!Number.isNaN(hour)) byHour[hour] += 1;
  });
  const peakCount = Math.max(1, ...byHour);
  const peakHour = byHour.indexOf(Math.max(...byHour));

  // Priority mix, using the same elapsed-time heuristic as the feed.
  const buckets = { P1: 0, P2: 0, P3: 0 };
  alerts.forEach((a) => {
    const minutes = (sampledAt - new Date(a.created_at).getTime()) / 60000;
    if (minutes < 3) buckets.P1 += 1;
    else if (minutes < 12) buckets.P2 += 1;
    else buckets.P3 += 1;
  });

  // Coarse clustering: coordinates rounded to ~1km so repeat locations group.
  const clusters = {};
  alerts.forEach((a) => {
    const key = `${Number(a.latitude).toFixed(2)}, ${Number(a.longitude).toFixed(2)}`;
    clusters[key] = (clusters[key] || 0) + 1;
  });
  const topClusters = Object.entries(clusters).sort((a, b) => b[1] - a[1]).slice(0, 5);

  const pending = (label) => (
    <div className="ks-card">
      <div className="ks-card__head">
        <Info size={15} strokeWidth={1.8} />
        <h3>{label.title}</h3>
      </div>
      <div className="ks-empty">
        <h3 className="ks-pending">—</h3>
        <p>{label.needs}</p>
      </div>
    </div>
  );

  return (
    <CommandShell
      title="Insights"
      alertCount={alerts.length}
      syncLabel={loaded ? "Live · 10s" : "Loading"}
      syncLive={loaded}
    >

      <section className="ks-stats">

        <article className="ks-stat ks-stat--red">
          <div className="ks-stat__top"><Flame size={15} strokeWidth={1.8} /><span>Open Now</span></div>
          <p className="ks-stat__value">{alerts.length}</p>
          <p className="ks-stat__meta">Currently active alerts</p>
        </article>

        <article className="ks-stat ks-stat--amber">
          <div className="ks-stat__top"><Clock size={15} strokeWidth={1.8} /><span>Peak Hour</span></div>
          <p className="ks-stat__value ks-stat__value--sm">
            {alerts.length ? `${String(peakHour).padStart(2, "0")}:00` : "—"}
          </p>
          <p className="ks-stat__meta">Busiest hour among open alerts</p>
        </article>

        <article className="ks-stat ks-stat--green">
          <div className="ks-stat__top"><MapPin size={15} strokeWidth={1.8} /><span>Distinct Zones</span></div>
          <p className="ks-stat__value">{topClusters.length}</p>
          <p className="ks-stat__meta">Coordinate clusters (~1km)</p>
        </article>

        <article className="ks-stat ks-stat--muted">
          <div className="ks-stat__top"><Timer size={15} strokeWidth={1.8} /><span>Avg Response</span></div>
          <p className="ks-stat__value ks-pending">—</p>
          <p className="ks-stat__meta">Needs handled_at timestamps</p>
        </article>

        <article className="ks-stat ks-stat--muted">
          <div className="ks-stat__top"><CheckCircle2 size={15} strokeWidth={1.8} /><span>Resolution Rate</span></div>
          <p className="ks-stat__value ks-pending">—</p>
          <p className="ks-stat__meta">Needs resolved-alert history</p>
        </article>

        <article className="ks-stat ks-stat--muted">
          <div className="ks-stat__top"><TrendingUp size={15} strokeWidth={1.8} /><span>Trend vs Yesterday</span></div>
          <p className="ks-stat__value ks-pending">—</p>
          <p className="ks-stat__meta">Needs historical query range</p>
        </article>

      </section>

      <div className="ks-split" style={{ marginBottom: 16 }}>

        <div className="ks-card">
          <div className="ks-card__head">
            <BarChart3 size={15} strokeWidth={1.8} />
            <h2>Open Alerts by Hour</h2>
            <span className="ks-chip ks-chip--ghost">24h clock</span>
          </div>
          <div className="ks-card__body">
            {alerts.length === 0 ? (
              <div className="ks-empty">
                <h3>No open alerts</h3>
                <p>The hourly distribution populates as alerts arrive.</p>
              </div>
            ) : (
              <div className="ks-chart">
                {byHour.map((count, hour) => (
                  <div className="ks-bar" key={hour} title={`${hour}:00 — ${count} alert(s)`}>
                    <div
                      className={`ks-bar__fill${count === peakCount && count > 0 ? " ks-bar__fill--red" : ""}`}
                      style={{
                        height: `${(count / peakCount) * 100}%`,
                        animationDelay: `${hour * 12}ms`,
                      }}
                    />
                    {hour % 3 === 0 && <span className="ks-bar__label">{hour}</span>}
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        <div className="ks-card">
          <div className="ks-card__head">
            <Flame size={15} strokeWidth={1.8} />
            <h2>Priority Mix</h2>
          </div>
          <div className="ks-card__body">
            {alerts.length === 0 ? (
              <div className="ks-empty"><p>Nothing open right now.</p></div>
            ) : (
              <div className="ks-donut__legend">
                {[
                  { key: "P1", label: "P1 · Critical (<3m)", color: "var(--emergency)" },
                  { key: "P2", label: "P2 · Elevated (<12m)", color: "var(--warning)" },
                  { key: "P3", label: "P3 · Standing", color: "var(--accent)" },
                ].map(({ key, label, color }) => (
                  <div key={key} style={{ display: "grid", gap: 6 }}>
                    <div className="ks-donut__row">
                      <span className="ks-dot" style={{ background: color }} />
                      {label}
                      <b>{buckets[key]}</b>
                    </div>
                    <div className="ks-track">
                      <div
                        className="ks-track__fill"
                        style={{
                          width: `${(buckets[key] / Math.max(1, alerts.length)) * 100}%`,
                          background: color,
                        }}
                      />
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

      </div>

      <div className="ks-split" style={{ marginBottom: 16 }}>

        <div className="ks-card">
          <div className="ks-card__head">
            <MapPin size={15} strokeWidth={1.8} />
            <h2>Most Common Locations</h2>
            <span className="ks-chip ks-chip--ghost">rounded to ~1km</span>
          </div>
          <div className="ks-card__body">
            {topClusters.length === 0 ? (
              <div className="ks-empty"><p>No coordinates to cluster.</p></div>
            ) : (
              <div className="ks-list">
                {topClusters.map(([key, count]) => (
                  <div className="ks-list__row" key={key}>
                    <MapPin size={14} strokeWidth={1.8} style={{ color: "var(--muted)" }} />
                    <span className="ks-mono">{key}</span>
                    <b>{count}</b>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        {pending({
          title: "Daily / Weekly / Monthly Volume",
          needs: "GET /alerts returns only active alerts. A date-ranged history endpoint is required before these series can be plotted.",
        })}

      </div>

      <div className="ks-split">
        {pending({
          title: "Incident Heatmap",
          needs: "Requires historical coordinates plus a tile provider key for the heat layer.",
        })}
        {pending({
          title: "Response Time Trend",
          needs: "Requires a handled_at column so time-to-resolution can be measured per incident.",
        })}
      </div>

    </CommandShell>
  );
}
