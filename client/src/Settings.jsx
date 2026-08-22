import { useEffect, useState } from "react";
import { useAuth } from "./lib/authContext";
import { API_BASE, pingBackend } from "./lib/api";
import { usePrefs } from "./lib/prefs";
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

const CONTACTS = [
  { label: "Police / Emergency", number: "112" },
  { label: "Ambulance", number: "108" },
  { label: "Fire", number: "101" },
  { label: "Women Helpline", number: "1091" },
];

function Group({ icon, tone = "info", title, children }) {
  // Bound to a capitalised local so JSX can render it as a component.
  const Icon = icon;

  return (
    <div className="pa-set__group">
      <h3 className="pa-set__grouptitle">
        <Icon size={16} strokeWidth={2} className={`pa-set__groupicon pa-set__groupicon--${tone}`} />
        {title}
      </h3>
      <div className="pa-set__card">{children}</div>
    </div>
  );
}

function Row({ label, hint, children }) {
  return (
    <div className="pa-set__row">
      <div className="pa-set__text">
        <strong>{label}</strong>
        <span>{hint}</span>
      </div>
      <div className="pa-set__control">{children}</div>
    </div>
  );
}

function Switch({ on, onChange, label }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      aria-label={label}
      className={`pa-switch${on ? " is-on" : ""}`}
      onClick={onChange}
    />
  );
}

/**
 * Console settings, rendered inside the control-room shell alongside Active
 * SOS, History and Admins rather than in a console of its own.
 */
export default function SettingsPanel() {
  const { user } = useAuth();

  // The same record the control room reads, so a toggle set here holds there.
  const [prefs, toggle] = usePrefs();

  const [apiStatus, setApiStatus] = useState("checking");
  const [geoState, setGeoState] = useState("unknown");

  const voiceSupported =
    typeof window !== "undefined" &&
    Boolean(window.SpeechRecognition || window.webkitSpeechRecognition);

  useEffect(() => {
    let cancelled = false;

    pingBackend()
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

  const yesNo = (ok, yes, no) => (
    <span className={`pa-tag ${ok ? "pa-tag--ok" : "pa-tag--muted"}`}>
      {ok ? <CheckCircle2 size={13} strokeWidth={2} /> : <XCircle size={13} strokeWidth={2} />}
      {ok ? yes : no}
    </span>
  );

  return (
    <section className="pa-set">
      <div className="pa-set__head">
        <div>
          <p className="pa-kicker">Console preferences</p>
          <h2>Settings</h2>
        </div>
        <span className="pa-tag pa-tag--muted">Saved on this device</span>
      </div>

      <Group icon={SettingsIcon} title="General">
        <Row label="Signed in as" hint={user?.email || "Google account"}>
          <span className="pa-tag pa-tag--info">{user?.name || "Unknown"}</span>
        </Row>
        <Row label="Contact number" hint="Sent with every alert · change it on the Home screen">
          <span className="pa-mono">{user?.phone || "—"}</span>
        </Row>
        <Row label="Operator role" hint="Role assignment is not yet modelled">
          <span className="pa-tag pa-tag--muted">Not configured</span>
        </Row>
      </Group>

      <Group icon={Palette} title="Appearance">
        <Row label="Theme" hint="Dark is the only control-room theme">
          <span className="pa-tag pa-tag--info">Dark</span>
        </Row>
        <Row label="Reduce motion" hint="Honours your system setting automatically">
          <Switch
            on={prefs.reduceMotion}
            onChange={() => toggle("reduceMotion")}
            label="Reduce motion"
          />
        </Row>
      </Group>

      <Group icon={Bell} tone="warn" title="Notifications">
        <Row
          label="Siren on new alert"
          hint="Plays in the control room when a new emergency arrives"
        >
          <Switch
            on={prefs.sirenOnNewAlert}
            onChange={() => toggle("sirenOnNewAlert")}
            label="Siren on new alert"
          />
        </Row>
        <Row
          label="Desktop notifications"
          hint="Requires browser permission and a service worker"
        >
          <Switch
            on={prefs.desktopNotifications}
            onChange={() => toggle("desktopNotifications")}
            label="Desktop notifications"
          />
        </Row>
        <Row label="Realtime alert stream" hint="Server sent events from /alerts/stream">
          <Switch
            on={prefs.realtime}
            onChange={() => toggle("realtime")}
            label="Realtime alert stream"
          />
        </Row>
      </Group>

      <Group icon={Phone} tone="danger" title="Emergency Contacts">
        {CONTACTS.map((contact) => (
          <Row
            key={contact.number}
            label={contact.label}
            hint="Dials directly from the device"
          >
            <a className="pa-set__dial" href={`tel:${contact.number}`}>
              {contact.number}
            </a>
          </Row>
        ))}
      </Group>

      <Group icon={Mic} title="Voice Recognition">
        <Row label="Browser support" hint="Web Speech API availability">
          {yesNo(voiceSupported, "Supported", "Not supported")}
        </Row>
        <Row label="Trigger phrases" hint="Matched against continuous transcription">
          <span className="pa-mono">“help me” · “sos”</span>
        </Row>
      </Group>

      <Group icon={MapPin} title="Location Tracking">
        <Row label="Geolocation permission" hint="Reported by the browser">
          <span
            className={`pa-tag ${
              geoState === "granted"
                ? "pa-tag--ok"
                : geoState === "denied"
                ? "pa-tag--danger"
                : "pa-tag--muted"
            }`}
          >
            {geoState}
          </span>
        </Row>
        <Row label="Ping interval" hint="While an SOS is active">
          <span className="pa-mono">5s</span>
        </Row>
        <Row label="Status poll" hint="Checks whether authorities closed the case">
          <span className="pa-mono">3s</span>
        </Row>
      </Group>

      <Group icon={Server} title="API & System">
        <Row label="Backend" hint={API_BASE.replace(/^https?:\/\//, "")}>
          {yesNo(
            apiStatus === "online",
            "Online",
            apiStatus === "checking" ? "Checking" : "Unreachable"
          )}
        </Row>
        <Row label="Database" hint="Supabase PostgreSQL">
          <span className="pa-tag pa-tag--muted">via backend</span>
        </Row>
        <Row label="Alert feed" hint="Server sent events from /alerts/stream">
          <span className="pa-mono">realtime</span>
        </Row>
      </Group>

      <Group icon={Info} title="About Parashu">
        <Row label="Platform" hint="Voice activated emergency response">
          <span className="pa-tag pa-tag--muted">Control room</span>
        </Row>
        <Row label="Build" hint="React · Vite · Express · Supabase">
          <span className="pa-mono">web</span>
        </Row>
        <Row label="Team" hint="Built and maintained by">
          <span className="pa-tag pa-tag--info">SpringX</span>
        </Row>
      </Group>
    </section>
  );
}
