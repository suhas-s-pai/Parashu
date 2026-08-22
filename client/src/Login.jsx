import { useState } from "react";
import { Navigate, useLocation } from "react-router-dom";
import {
  ShieldCheck,
  HelpCircle,
  User,
  Phone,
  ArrowRight,
  ArrowLeft,
  Lock,
} from "lucide-react";
import { useAuth } from "./lib/authContext";

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

// Professional Emergency Response Radar Background (Deep Blue & Orange/Red Accents)
function NeonRadarBackground() {
  return (
    <div className="pa-neon-radar-system" aria-hidden="true">
      {/* Soft Ambient Deep Blue & Emergency Red Halos */}
      <div className="pa-neon-glow pa-neon-glow--blue" />
      <div className="pa-neon-glow pa-neon-glow--orange" />

      {/* SVG Thin Concentric Emergency Radar Rings */}
      <svg
        className="pa-radar-svg"
        viewBox="0 0 600 600"
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
      >
        <defs>
          {/* Deep Electric Blue to Emergency Red Accent Gradients */}
          <linearGradient id="emergencyGrad1" x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stopColor="#3b82f6" stopOpacity="0.85" />
            <stop offset="50%" stopColor="#2563eb" stopOpacity="0.6" />
            <stop offset="85%" stopColor="#f97316" stopOpacity="0.75" />
            <stop offset="100%" stopColor="#ef4444" stopOpacity="0.85" />
          </linearGradient>

          <linearGradient id="emergencyGrad2" x1="100%" y1="0%" x2="0%" y2="100%">
            <stop offset="0%" stopColor="#60a5fa" stopOpacity="0.8" />
            <stop offset="60%" stopColor="#1d4ed8" stopOpacity="0.5" />
            <stop offset="100%" stopColor="#f97316" stopOpacity="0.7" />
          </linearGradient>
        </defs>

        {/* 1. Outer Thin Concentric Ring (Rotates Slowly Clockwise) */}
        <g className="pa-radar-group pa-radar-rotate-cw">
          <circle cx="300" cy="300" r="275" stroke="#2563eb" strokeWidth="1" strokeOpacity="0.3" />
          <circle cx="300" cy="300" r="275" stroke="url(#emergencyGrad1)" strokeWidth="1.5" strokeDasharray="60 220" strokeOpacity="0.85" />
          {/* Moving Emergency Indicator Point 1 */}
          <circle cx="575" cy="300" r="3.5" fill="#f97316" className="pa-particle-glow-orange" />
        </g>

        {/* 2. Middle Ring Group (Rotates Counter-Clockwise) */}
        <g className="pa-radar-group pa-radar-rotate-ccw">
          <circle cx="300" cy="300" r="225" stroke="#3b82f6" strokeWidth="1" strokeOpacity="0.25" />
          <circle cx="300" cy="300" r="225" stroke="url(#emergencyGrad2)" strokeWidth="1.5" strokeDasharray="40 180" strokeOpacity="0.75" />
          {/* Moving Blue Point 2 */}
          <circle cx="300" cy="75" r="3.5" fill="#60a5fa" className="pa-particle-glow-blue" />
        </g>

        {/* 3. Inner Ring Group (Rotates Slowly Clockwise) */}
        <g className="pa-radar-group pa-radar-rotate-cw-slow">
          <circle cx="300" cy="300" r="175" stroke="#2563eb" strokeWidth="1" strokeOpacity="0.3" />
          <circle cx="300" cy="300" r="175" stroke="#ef4444" strokeWidth="1.4" strokeDasharray="30 200" strokeOpacity="0.8" />
          {/* Inner Accent Ring */}
          <circle cx="300" cy="300" r="125" stroke="#3b82f6" strokeWidth="1" strokeOpacity="0.2" />
          {/* Moving Orange Point 3 */}
          <circle cx="425" cy="300" r="3" fill="#f97316" className="pa-particle-glow-orange" />
        </g>

        {/* Minimal Crosshair Axes Lines */}
        <line x1="300" y1="20" x2="300" y2="580" stroke="#3b82f6" strokeWidth="0.8" strokeOpacity="0.2" strokeDasharray="4 8" />
        <line x1="20" y1="300" x2="580" y2="300" stroke="#3b82f6" strokeWidth="0.8" strokeOpacity="0.2" strokeDasharray="4 8" />
      </svg>

      {/* Subtle Slow Rotating Radar Sweep Beam */}
      <div className="pa-radar-sweep-container">
        <div className="pa-radar-sweep-beam" />
      </div>

      {/* Darkened Center Overlay for Card Content Readability */}
      <div className="pa-radar-center-darkener" />
    </div>
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

  const displayError = location.state?.authError || authError;

  // Step state: "landing" | "selection" | "personal" | "admin"
  // Default to "admin" if an error notification was passed so the user sees it immediately
  const [step, setStep] = useState(displayError ? "admin" : "landing");

  // Reached with a live session — a refresh, or the return leg of the Google
  // redirect. Administrators go straight to the control room; everyone else
  // resumes wherever they were headed unless denied admin access.
  if (user) {
    if (isAdmin) {
      return <Navigate to={location.state?.from || "/dashboard"} replace />;
    }
    if (!location.state?.authError && location.state?.from !== "/dashboard") {
      return <Navigate to={location.state?.from || "/"} replace />;
    }
  }

  const handleGoogleClick = async () => {
    setPending("google");
    try {
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

  const handleAdminClick = async () => {
    setPending("admin");
    try {
      await signInAsAdmin();
    } catch {
      setPending("");
    }
  };

  return (
    <div className="pa-auth-page">
      {/* Emergency Response Radar Background (Deep Blue + Orange/Red Accents) */}
      <NeonRadarBackground />

      <div className="pa-auth-container">
        {/* Top Brand Header */}
        <div className="pa-auth__brand-header">
          <div className="pa-logo-circle">
            <img src="/symbol.png" alt="Parashu Logo" />
          </div>
          <div className="pa-auth__brand-text">
            <span className="pa-auth__wordmark">PARASHU</span>
            <span className="pa-auth__subwordmark">Safety Platform</span>
          </div>
          <span className="pa-auth__live">
            <span className="ks-dot ks-dot--green" /> Live
          </span>
        </div>

        {/* STEP 0: LANDING */}
        {step === "landing" && (
          <div className="pa-auth__step pa-auth__step--landing">
            {/* Perfectly Circular Logo Container */}
            <div className="pa-landing-logo-circle">
              <img src="/symbol.png" alt="Parashu Symbol" />
            </div>

            <h1 className="pa-auth__headline">PARASHU</h1>
            <p className="pa-auth__tagline">
              Emergency Response &amp; Safety Platform
            </p>

            {/* Small elegant accent line below the subtitle */}
            <span className="pa-auth__accent-line" aria-hidden="true" />

            <p className="pa-auth__motto">
              Protect. Respond. Connect.
            </p>

            {/* Compact & Premium Continue Button */}
            <button
              type="button"
              className="pa-landing-btn"
              onClick={() => setStep("selection")}
            >
              <span>Continue to Parashu</span>
              <ArrowRight size={15} />
            </button>
          </div>
        )}

        {/* STEP 1: SELECTION */}
        {step === "selection" && (
          <div className="pa-auth__step pa-auth__step--selection">
            <div className="pa-auth__step-head">
              <button
                type="button"
                className="pa-auth__back-btn"
                onClick={() => setStep("landing")}
              >
                <ArrowLeft size={14} /> Back
              </button>
              <h2>Select Portal</h2>
              <p>Choose your access destination</p>
            </div>

            <div className="pa-selection-grid">
              {/* Card 1: Personal Safety */}
              <div className="pa-selection-card">
                <div className="pa-selection-card__icon pa-selection-card__icon--blue">
                  <ShieldCheck size={24} strokeWidth={2} />
                </div>
                <div className="pa-selection-card__body">
                  <h3>PERSONAL SAFETY</h3>
                  <p>Access your personal emergency and safety dashboard.</p>
                </div>
                <button
                  type="button"
                  className="ks-btn ks-btn--primary pa-selection-card__btn"
                  onClick={() => setStep("personal")}
                >
                  <span>Continue</span>
                  <ArrowRight size={16} />
                </button>
              </div>

              {/* Card 2: Administrator */}
              <div className="pa-selection-card pa-selection-card--admin">
                <div className="pa-selection-card__icon pa-selection-card__icon--red">
                  <Lock size={24} strokeWidth={2} />
                </div>
                <div className="pa-selection-card__body">
                  <h3>ADMINISTRATOR</h3>
                  <p>Access the emergency control room.</p>
                </div>
                <button
                  type="button"
                  className="ks-btn ks-btn--danger pa-selection-card__btn"
                  onClick={() => setStep("admin")}
                >
                  <span>Administrator Login</span>
                  <ArrowRight size={16} />
                </button>
              </div>
            </div>
          </div>
        )}

        {/* STEP 2A: PERSONAL SAFETY LOGIN */}
        {step === "personal" && (
          <div className="pa-auth__step pa-auth__step--form">
            <div className="pa-auth__step-head">
              <button
                type="button"
                className="pa-auth__back-btn"
                onClick={() => setStep("selection")}
              >
                <ArrowLeft size={14} /> Back to Selection
              </button>
            </div>

            <div className="ks-authcard">
              <div className="ks-authcard__head">
                <span className="ks-authcard__badge ks-authcard__badge--user">
                  <ShieldCheck size={15} strokeWidth={2} />
                </span>
                <div>
                  <h2 className="ks-authcard__title">Personal Safety</h2>
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
          </div>
        )}

        {/* STEP 2B: ADMINISTRATOR LOGIN */}
        {step === "admin" && (
          <div className="pa-auth__step pa-auth__step--form">
            <div className="pa-auth__step-head">
              <button
                type="button"
                className="pa-auth__back-btn"
                onClick={() => setStep("selection")}
              >
                <ArrowLeft size={14} /> Back to Selection
              </button>
            </div>

            {displayError && (
              <div className="ks-google__notice" style={{ marginBottom: 16 }}>
                <HelpCircle size={14} strokeWidth={1.9} />
                {displayError}
              </div>
            )}

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

              <button
                type="button"
                className="ks-google"
                onClick={handleAdminClick}
                disabled={Boolean(pending)}
              >
                <GoogleMark />
                {pending === "admin" ? "Redirecting to Google…" : "Continue with Google"}
              </button>
            </div>
          </div>
        )}

        <p className="ks-auth__foot">SPRINGX &rarr; PARASHU</p>
      </div>
    </div>
  );
}
