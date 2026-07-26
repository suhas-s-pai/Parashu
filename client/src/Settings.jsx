import { useEffect, useState } from "react";
import axios from "axios";
import {
  Settings as SettingsIcon,
  Palette,
  Bell,
  Phone,
  Mic,
  MapPin,
  Server,
  Info,
  CheckCircle2,
  XCircle,
} from "lucide-react";
import CommandShell from "./CommandShell";

const PREFS_KEY = "kalisos.prefs";

const CONTACTS = [
  { label: "Police / Emergency", number: "112" },
  { label: "Ambulance", number: "108" },
  { label: "Fire", number: "101" },
  { label: "Women Helpline", number: "1091" },
];

function readPrefs() {
  try {
    return JSON.parse(localStorage.getItem(PREFS_KEY)) || {};
  } catch {
    return {};
  }
}

export default function Settings() {
  const user = JSON.parse(localStorage.getItem("user") || "null");

  // Local display preferences. Stored on this device only — there is no
  // settings endpoint to sync them to.
  const [prefs, setPrefs] = useState(() => ({
    sirenOnNewAlert: true,
    desktopNotifications: false,
    reduceMotion: false,
    ...readPrefs(),
  }));

  const [apiStatus, setApiStatus] = useState("checking");
  const [geoState, setGeoState] = useState("unknown");

  const voiceSupported =
    typeof window !== "undefined" &&
    Boolean(window.SpeechRecognition || window.webkitSpeechRecognition);

  useEffect(() => {
    localStorage.setItem(PREFS_KEY, JSON.stringify(prefs));
  }, [prefs]);

  useEffect(() => {
    let cancelled = false;

    axios
      .get("https://kalisos-backend.onrender.com/", { timeout: 8000 })
      .then(() => !cancelled && setApiStatus("online"))
      .catch(() => !cancelled && setApiStatus("offline"));

    if (navigator.permissions?.query) {
      navigator.permissions
        .query({ name: "geolocation" })
        .then((res) => !cancelled && setGeoState(res.state))
        .catch(() => !cancelled && setGeoState("unknown"));
    }

    return () => {
      cancelled = true;
    };
  }, []);

  const toggle = (key) => setPrefs((p) => ({ ...p, [key]: !p[key] }));

  const yesNo = (ok, yes, no) => (
    <span className={`ks-chip ${ok ? "ks-chip--green" : "ks-chip--ghost"}`}>
      {ok ? <CheckCircle2 size={12} strokeWidth={2} /> : <XCircle size={12} strokeWidth={2} />}
      {ok ? yes : no}
    </span>
  );

  return (
    <CommandShell title="Settings" syncLabel="Local" >

      <div className="ks-settings">

        <nav className="ks-settings__nav">
          {[
            { label: "General", icon: SettingsIcon },
            { label: "Appearance", icon: Palette },
            { label: "Notifications", icon: Bell },
            { label: "Contacts", icon: Phone },
            { label: "Voice", icon: Mic },
            { label: "Location", icon: MapPin },
            { label: "System", icon: Server },
          ].map((section) => (
            <a
              className="ks-nav__item"
              href={`#${section.label.toLowerCase()}`}
              key={section.label}
            >
              <section.icon size={16} strokeWidth={1.8} />
              <span>{section.label}</span>
            </a>
          ))}
        </nav>

        <div style={{ display: "grid", gap: 16 }}>

          <div className="ks-card" id="general">
            <div className="ks-card__head"><SettingsIcon size={15} strokeWidth={1.8} /><h2>General</h2></div>
            <div className="ks-row">
              <div className="ks-row__text"><strong>Signed in as</strong><span>Stored on this device only</span></div>
              <span className="ks-chip ks-chip--blue">{user?.name || "Unknown"}</span>
            </div>
            <div className="ks-row">
              <div className="ks-row__text"><strong>Contact number</strong><span>Sent with every alert</span></div>
              <span className="ks-mono">{user?.phone || "—"}</span>
            </div>
            <div className="ks-row">
              <div className="ks-row__text"><strong>Operator role</strong><span>Role assignment is not yet modelled</span></div>
              <span className="ks-chip ks-chip--ghost ks-pending">not configured</span>
            </div>
          </div>

          <div className="ks-card" id="appearance">
            <div className="ks-card__head"><Palette size={15} strokeWidth={1.8} /><h2>Appearance</h2></div>
            <div className="ks-row">
              <div className="ks-row__text"><strong>Theme</strong><span>Dark is the only control-room theme</span></div>
              <span className="ks-chip ks-chip--blue">Dark</span>
            </div>
            <div className="ks-row">
              <div className="ks-row__text"><strong>Reduce motion</strong><span>Honours your system setting automatically</span></div>
              <button
                className={`ks-toggle${prefs.reduceMotion ? " is-on" : ""}`}
                onClick={() => toggle("reduceMotion")}
                aria-label="Reduce motion"
              />
            </div>
          </div>

          <div className="ks-card" id="notifications">
            <div className="ks-card__head"><Bell size={15} strokeWidth={1.8} /><h2>Notifications</h2></div>
            <div className="ks-row">
              <div className="ks-row__text"><strong>Siren on new alert</strong><span>Plays when the feed count increases</span></div>
              <button
                className={`ks-toggle${prefs.sirenOnNewAlert ? " is-on" : ""}`}
                onClick={() => toggle("sirenOnNewAlert")}
                aria-label="Siren on new alert"
              />
            </div>
            <div className="ks-row">
              <div className="ks-row__text"><strong>Desktop notifications</strong><span>Requires browser permission and a service worker</span></div>
              <button
                className={`ks-toggle${prefs.desktopNotifications ? " is-on" : ""}`}
                onClick={() => toggle("desktopNotifications")}
                aria-label="Desktop notifications"
              />
            </div>
          </div>

          <div className="ks-card" id="contacts">
            <div className="ks-card__head"><Phone size={15} strokeWidth={1.8} /><h2>Emergency Contacts</h2></div>
            {CONTACTS.map((c) => (
              <div className="ks-row" key={c.number}>
                <div className="ks-row__text"><strong>{c.label}</strong><span>Dials directly from the device</span></div>
                <a className="ks-btn ks-btn--ghost ks-btn--sm" href={`tel:${c.number}`}>{c.number}</a>
              </div>
            ))}
          </div>

          <div className="ks-card" id="voice">
            <div className="ks-card__head"><Mic size={15} strokeWidth={1.8} /><h2>Voice Recognition</h2></div>
            <div className="ks-row">
              <div className="ks-row__text"><strong>Browser support</strong><span>Web Speech API availability</span></div>
              {yesNo(voiceSupported, "Supported", "Not supported")}
            </div>
            <div className="ks-row">
              <div className="ks-row__text"><strong>Trigger phrases</strong><span>Matched against continuous transcription</span></div>
              <span className="ks-mono">“help me” · “sos”</span>
            </div>
          </div>

          <div className="ks-card" id="location">
            <div className="ks-card__head"><MapPin size={15} strokeWidth={1.8} /><h2>Location Tracking</h2></div>
            <div className="ks-row">
              <div className="ks-row__text"><strong>Geolocation permission</strong><span>Reported by the browser</span></div>
              <span className={`ks-chip ${geoState === "granted" ? "ks-chip--green" : geoState === "denied" ? "ks-chip--red" : "ks-chip--ghost"}`}>
                {geoState}
              </span>
            </div>
            <div className="ks-row">
              <div className="ks-row__text"><strong>Ping interval</strong><span>While an SOS is active</span></div>
              <span className="ks-mono">5s</span>
            </div>
            <div className="ks-row">
              <div className="ks-row__text"><strong>Status poll</strong><span>Checks whether authorities closed the case</span></div>
              <span className="ks-mono">3s</span>
            </div>
          </div>

          <div className="ks-card" id="system">
            <div className="ks-card__head"><Server size={15} strokeWidth={1.8} /><h2>API &amp; System</h2></div>
            <div className="ks-row">
              <div className="ks-row__text"><strong>Backend</strong><span>kalisos-backend.onrender.com</span></div>
              {yesNo(apiStatus === "online", "Online", apiStatus === "checking" ? "Checking" : "Unreachable")}
            </div>
            <div className="ks-row">
              <div className="ks-row__text"><strong>Database</strong><span>Supabase PostgreSQL</span></div>
              <span className="ks-chip ks-chip--ghost">via backend</span>
            </div>
            <div className="ks-row">
              <div className="ks-row__text"><strong>Alert feed interval</strong><span>Control room polling rate</span></div>
              <span className="ks-mono">2s</span>
            </div>
          </div>

          <div className="ks-card">
            <div className="ks-card__head"><Info size={15} strokeWidth={1.8} /><h2>About KaliSOS</h2></div>
            <div className="ks-card__body" style={{ fontSize: 13, color: "var(--muted)", display: "grid", gap: 6 }}>
              <div className="ks-list__row" style={{ padding: "6px 0" }}>
                <span>Voice activated emergency response platform</span>
              </div>
              <div className="ks-list__row" style={{ padding: "6px 0" }}>
                <span>Build</span><b>React · Vite · Express · Supabase</b>
              </div>
              <div className="ks-list__row" style={{ padding: "6px 0", borderBottom: "none" }}>
                <span>Team</span><b>SpringX</b>
              </div>
            </div>
          </div>

        </div>

      </div>

    </CommandShell>
  );
}
