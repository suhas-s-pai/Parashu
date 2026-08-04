import { useState } from "react";
import { Navigate, useLocation } from "react-router-dom";
import {
  ShieldAlert,
  Mic,
  MapPin,
  ShieldCheck,
  CheckCircle2,
  XCircle,
  HelpCircle,
  User,
  Phone,
  ArrowRight,
  Lock,
  Mail,
  KeyRound,
} from "lucide-react";
import { useAuth } from "./lib/authContext";

// Read once: these reflect what the browser actually supports, not a
// decorative claim. Home relies on both APIs, so surfacing their state here
// tells the operator upfront whether the device is fully capable.
function readDeviceChecks() {
  const voice = Boolean(
    typeof window !== "undefined" &&
      (window.SpeechRecognition || window.webkitSpeechRecognition)
  );
  const geo = typeof navigator !== "undefined" && "geolocation" in navigator;
  const secure =
    typeof window !== "undefined" &&
    (window.isSecureContext || window.location.hostname === "localhost");

  return [
    { label: "Voice recognition", ok: voice },
    { label: "Location services", ok: geo },
    { label: "Secure connection", ok: secure },
  ];
}

// The real multi-color "G" mark, inline so it renders without a network
// request to Google's asset CDN.
function GoogleMark() {
  return (
    <svg width="18" height="18" viewBox="0 0 18 18" aria-hidden="true">
      <path fill="#4285F4" d="M17.64 9.2c0-.64-.06-1.25-.16-1.84H9v3.48h4.84a4.14 4.14 0 0 1-1.8 2.72v2.26h2.9c1.7-1.57 2.7-3.88 2.7-6.62Z" />
      <path fill="#34A853" d="M9 18c2.43 0 4.47-.8 5.96-2.18l-2.9-2.26c-.8.54-1.84.86-3.06.86-2.35 0-4.34-1.59-5.05-3.72H.94v2.33A9 9 0 0 0 9 18Z" />
      <path fill="#FBBC05" d="M3.95 10.7A5.4 5.4 0 0 1 3.66 9c0-.59.1-1.17.29-1.7V4.97H.94A9 9 0 0 0 0 9c0 1.45.35 2.83.94 4.03l3.01-2.33Z" />
      <path fill="#EA4335" d="M9 3.58c1.32 0 2.51.46 3.44 1.35l2.58-2.58C13.46.89 11.43 0 9 0A9 9 0 0 0 .94 4.97l3.01 2.33C4.66 5.17 6.65 3.58 9 3.58Z" />
    </svg>
  );
}

export default function Login() {
  const {
    user,
    isAdmin,
    authError,
    signInWithGoogle,
    signInWithNamePhone,
    signInAsAdmin,
  } = useAuth();
  const location = useLocation();

  const [pending, setPending] = useState("");

  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [guestError, setGuestError] = useState("");

  const [adminEmail, setAdminEmail] = useState("");
  const [adminPassword, setAdminPassword] = useState("");

  // Read once on mount via lazy initializer — a plain synchronous read, so no
  // effect is needed to produce it.
  const [checks] = useState(readDeviceChecks);

  // Reached with a live session — a refresh, or the return leg of the Google
  // redirect. Administrators go straight to the control room; everyone else
  // resumes wherever they were headed.
  if (user) {
    const fallback = isAdmin ? "/dashboard" : "/";
    return <Navigate to={location.state?.from || fallback} replace />;
  }

  const handleGoogleClick = async () => {
    setPending("google");

    try {
      // Resolves by navigating away to Google, so the pending state is only
      // cleared when something went wrong.
      await signInWithGoogle();
    } catch {
      setPending("");
    }
  };

  const handleGuestSubmit = async (event) => {
    event.preventDefault();
    setGuestError("");

    if (!name.trim()) {
      setGuestError("Enter your name.");
      return;
    }

    if (phone.replace(/\D/g, "").length < 8) {
      setGuestError("Enter a reachable phone number, including the area code.");
      return;
    }

    setPending("guest");

    try {
      await signInWithNamePhone(name.trim(), phone.trim());
    } catch {
      setPending("");
    }
  };

  const handleAdminSubmit = async (event) => {
    event.preventDefault();
    setPending("admin");

    try {
      await signInAsAdmin(adminEmail.trim(), adminPassword);
    } catch {
      setPending("");
      setAdminPassword("");
    }
  };

  return (
    <div className="ks-auth">

      <aside className="ks-auth__brand">

        <div className="ks-auth__glow ks-auth__glow--red" />
        <div className="ks-auth__glow ks-auth__glow--blue" />

        <div className="ks-auth__radar" aria-hidden="true">
          <span className="ks-auth__radarRing" />
          <span className="ks-auth__radarRing" />
          <span className="ks-auth__radarRing" />
          <span className="ks-auth__radarSweep" />
        </div>

        <div className="ks-auth__brandTop">
          <span className="ks-auth__mark">
            <ShieldAlert size={19} strokeWidth={2.1} />
          </span>
          <span className="ks-auth__wordmark">Para<span>shu</span></span>

          <span className="ks-auth__live">
            <span className="ks-dot ks-dot--green" />
            Live
          </span>
        </div>

        <div className="ks-auth__brandMid">
          <h1 className="ks-auth__headline">
            Emergency response, <em>the instant</em> it's needed.
          </h1>
          <p className="ks-auth__tagline">
            Voice activated alerts, live location tracking and control room
            monitoring in one platform.
          </p>
        </div>

        <div className="ks-auth__checks">
          {checks.map((check) => (
            <div className="ks-auth__check" key={check.label}>
              {check.ok ? (
                <CheckCircle2 size={16} strokeWidth={1.9} style={{ color: "var(--success)" }} />
              ) : (
                <XCircle size={16} strokeWidth={1.9} style={{ color: "var(--faint)" }} />
              )}
              <span>{check.label}</span>
              {check.label === "Voice recognition" && <Mic size={14} strokeWidth={1.8} />}
              {check.label === "Location services" && <MapPin size={14} strokeWidth={1.8} />}
              {check.label === "Secure connection" && <ShieldCheck size={14} strokeWidth={1.8} />}
            </div>
          ))}
        </div>

      </aside>

      <section className="ks-auth__panel">

        <div className="ks-auth__form">

          {authError && (
            <div className="ks-google__notice">
              <HelpCircle size={14} strokeWidth={1.9} />
              {authError}
            </div>
          )}

          {/* ---------- Path 1 + 2: people who may need help ---------- */}

          <div className="ks-authcard">
            <div className="ks-authcard__head">
              <span className="ks-authcard__badge ks-authcard__badge--user">
                <ShieldCheck size={15} strokeWidth={2} />
              </span>
              <div>
                <h2 className="ks-authcard__title">I need protection</h2>
                <p className="ks-authcard__sub">Personal safety account</p>
              </div>
            </div>

            <button
              type="button"
              className="ks-google"
              onClick={handleGoogleClick}
              disabled={Boolean(pending)}
            >
              <GoogleMark />
              {pending === "google" ? "Redirecting to Google…" : "Continue with Google"}
            </button>

            <div className="ks-auth__divider">or</div>

            <form className="ks-auth__fields" onSubmit={handleGuestSubmit}>
              <label className="ks-field">
                <span className="ks-field__label">Full name</span>
                <span className="ks-searchwrap">
                  <User size={15} strokeWidth={1.8} />
                  <input
                    className="ks-input"
                    type="text"
                    placeholder="Enter your name"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    autoComplete="name"
                  />
                </span>
              </label>

              <label className="ks-field">
                <span className="ks-field__label">Phone number</span>
                <span className="ks-searchwrap">
                  <Phone size={15} strokeWidth={1.8} />
                  <input
                    className="ks-input"
                    type="tel"
                    placeholder="Phone number responders can call"
                    value={phone}
                    onChange={(e) => setPhone(e.target.value)}
                    autoComplete="tel"
                  />
                </span>
              </label>

              {guestError && <p className="ks-authcard__error">{guestError}</p>}

              <button
                type="submit"
                className="ks-btn ks-auth__submit"
                disabled={Boolean(pending)}
              >
                {pending === "guest" ? "Signing in…" : "Continue with Name + Phone"}
                <ArrowRight size={15} strokeWidth={2} />
              </button>
            </form>
          </div>

          {/* ---------- Path 3: control room staff ---------- */}

          <div className="ks-authsplit">
            <span>Control room staff</span>
          </div>

          <div className="ks-authcard ks-authcard--admin">
            <div className="ks-authcard__head">
              <span className="ks-authcard__badge ks-authcard__badge--admin">
                <Lock size={15} strokeWidth={2} />
              </span>
              <div>
                <h2 className="ks-authcard__title">Administrator Login</h2>
                <p className="ks-authcard__sub">Emergency control room access</p>
              </div>
            </div>

            <form className="ks-auth__fields" onSubmit={handleAdminSubmit}>
              <label className="ks-field">
                <span className="ks-field__label">Email</span>
                <span className="ks-searchwrap">
                  <Mail size={15} strokeWidth={1.8} />
                  <input
                    className="ks-input"
                    type="email"
                    placeholder="admin@yourdomain.com"
                    value={adminEmail}
                    onChange={(e) => setAdminEmail(e.target.value)}
                    autoComplete="email"
                  />
                </span>
              </label>

              <label className="ks-field">
                <span className="ks-field__label">Password</span>
                <span className="ks-searchwrap">
                  <KeyRound size={15} strokeWidth={1.8} />
                  <input
                    className="ks-input"
                    type="password"
                    placeholder="Administrator password"
                    value={adminPassword}
                    onChange={(e) => setAdminPassword(e.target.value)}
                    autoComplete="current-password"
                  />
                </span>
              </label>

              <button
                type="submit"
                className="ks-btn ks-btn--danger ks-auth__submit"
                disabled={Boolean(pending) || !adminEmail || !adminPassword}
              >
                {pending === "admin" ? "Verifying…" : "Login as Admin"}
                <ArrowRight size={15} strokeWidth={2} />
              </button>
            </form>
          </div>

          <p className="ks-auth__note">
            <HelpCircle size={13} strokeWidth={1.8} />
            Your session stays signed in on this device until you log out.
            Administrator accounts open the control room instead of the personal
            safety screen.
          </p>

        </div>

        <p className="ks-auth__foot">SPRINGX · PARASHU EMERGENCY PLATFORM</p>

      </section>

    </div>
  );
}
