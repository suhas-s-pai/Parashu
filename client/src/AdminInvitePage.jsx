import { useEffect, useState } from "react";
import { useParams, Link } from "react-router-dom";
import { verifyAdminInvitation, submitAdminRequest } from "./lib/api";
import { ShieldAlert, CheckCircle2, AlertTriangle, ArrowLeft } from "lucide-react";

export default function AdminInvitePage() {
  const { token } = useParams();

  const [verifying, setVerifying] = useState(true);
  const [tokenValid, setTokenValid] = useState(false);
  const [errorMsg, setErrorMsg] = useState("");

  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [formError, setFormError] = useState("");

  useEffect(() => {
    let active = true;

    async function checkToken() {
      try {
        setVerifying(true);
        const res = await verifyAdminInvitation(token);
        if (!active) return;

        if (res?.valid) {
          setTokenValid(true);
        } else {
          setTokenValid(false);
          if (res?.error === "INVITATION_EXPIRED") {
            setErrorMsg("This administrator invitation has expired (5-minute limit). Please ask an existing administrator for a new QR invitation.");
          } else if (res?.error === "INVITATION_ALREADY_USED") {
            setErrorMsg("This administrator invitation has already been used.");
          } else {
            setErrorMsg("Invalid administrator invitation link or token.");
          }
        }
      } catch {
        if (active) {
          setTokenValid(false);
          setErrorMsg("Could not verify invitation. Please check your network connection.");
        }
      } finally {
        if (active) setVerifying(false);
      }
    }

    if (token) {
      checkToken();
    } else {
      setVerifying(false);
      setErrorMsg("Missing invitation token.");
    }

    return () => {
      active = false;
    };
  }, [token]);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setFormError("");

    if (!name.trim()) {
      setFormError("Full Name is required.");
      return;
    }
    if (!email.trim() || !email.includes("@")) {
      setFormError("Enter a valid email address.");
      return;
    }
    if (!password || password.length < 6) {
      setFormError("Password must be at least 6 characters long.");
      return;
    }

    setSubmitting(true);

    try {
      const res = await submitAdminRequest({
        token,
        name: name.trim(),
        email: email.trim(),
        password,
      });

      if (res?.success) {
        setSubmitted(true);
      } else {
        setFormError(res?.message || "Could not submit admin request.");
      }
    } catch (err) {
      setFormError(
        err?.response?.data?.message || err?.message || "Failed to submit administrator request."
      );
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="ks-home" style={{ minHeight: "100vh", display: "flex", flexDirection: "column" }}>
      <header className="ks-home__head">
        <div className="ks-home__brand">
          <ShieldAlert size={22} className="ks-home__logo" />
          <span className="ks-home__title">Parashu</span>
        </div>
        <Link to="/" className="ks-btn ks-btn--ghost" style={{ fontSize: 13, gap: 6 }}>
          <ArrowLeft size={14} /> Back to Home
        </Link>
      </header>

      <main className="ks-home__main" style={{ flex: 1, display: "grid", placeItems: "center", padding: "24px 16px" }}>
        <div className="ks-authcard" style={{ maxWidth: 480, width: "100%", margin: "auto" }}>
          <div className="ks-authcard__header">
            <div className="ks-authcard__badge ks-authcard__badge--admin">
              <ShieldAlert size={18} />
            </div>
            <div>
              <h2 className="ks-authcard__title">Parashu Administrator Invitation</h2>
              <p className="ks-authcard__sub">
                You have been invited to become a Parashu administrator.
              </p>
            </div>
          </div>

          {verifying && (
            <div style={{ padding: "32px 16px", textAlign: "center", color: "var(--muted)" }}>
              <p>Verifying invitation token…</p>
            </div>
          )}

          {!verifying && !tokenValid && (
            <div style={{ padding: "20px 0", display: "grid", gap: 16 }}>
              <div style={{ padding: "14px 16px", borderRadius: 8, background: "rgba(220, 38, 38, 0.15)", border: "1px solid rgba(220, 38, 38, 0.3)", color: "#fca5a5", fontSize: 13.5, display: "flex", alignItems: "flex-start", gap: 10 }}>
                <AlertTriangle size={18} style={{ flex: "none", marginTop: 2 }} />
                <div>
                  <strong style={{ display: "block", color: "#ef4444" }}>Invitation Expired or Invalid</strong>
                  <span>{errorMsg}</span>
                </div>
              </div>
              <Link to="/login" className="ks-btn ks-btn--primary" style={{ justifyContent: "center" }}>
                Return to Admin Login
              </Link>
            </div>
          )}

          {!verifying && tokenValid && submitted && (
            <div style={{ padding: "20px 0", display: "grid", gap: 16 }}>
              <div style={{ padding: "16px", borderRadius: 8, background: "rgba(34, 197, 94, 0.14)", border: "1px solid rgba(34, 197, 94, 0.3)", color: "#4ade80", fontSize: 14, display: "flex", alignItems: "flex-start", gap: 10 }}>
                <CheckCircle2 size={20} style={{ flex: "none", marginTop: 2 }} />
                <div>
                  <strong style={{ display: "block", fontSize: 15, color: "#22c55e", marginBottom: 4 }}>Admin Request Submitted!</strong>
                  <p style={{ margin: 0, fontSize: 13, color: "var(--text)" }}>
                    Your request for administrator access has been sent. An existing administrator must approve your request in the Parashu Control Room before you can log in.
                  </p>
                </div>
              </div>
              <Link to="/login" className="ks-btn ks-btn--ghost" style={{ justifyContent: "center" }}>
                Go to Login Page
              </Link>
            </div>
          )}

          {!verifying && tokenValid && !submitted && (
            <form onSubmit={handleSubmit} style={{ display: "grid", gap: 16, marginTop: 16 }}>
              <label className="ks-field">
                <span className="ks-field__label">Full Name</span>
                <input
                  className="ks-input"
                  type="text"
                  placeholder="e.g. Alex Mercer"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  required
                />
              </label>

              <label className="ks-field">
                <span className="ks-field__label">Email Address</span>
                <input
                  className="ks-input"
                  type="email"
                  placeholder="alex@domain.com"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  required
                />
              </label>

              <label className="ks-field">
                <span className="ks-field__label">Password</span>
                <input
                  className="ks-input"
                  type="password"
                  placeholder="At least 6 characters"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                  minLength={6}
                />
              </label>

              {formError && (
                <div style={{ padding: "10px 12px", borderRadius: 6, background: "rgba(220,38,38,0.15)", border: "1px solid rgba(220,38,38,0.3)", color: "#fca5a5", fontSize: 13 }}>
                  Error: {formError}
                </div>
              )}

              <button
                type="submit"
                className="ks-btn ks-btn--danger"
                style={{ width: "100%", justifyContent: "center", marginTop: 8 }}
                disabled={submitting}
              >
                {submitting ? "Submitting Request…" : "Submit Admin Access Request"}
              </button>
            </form>
          )}
        </div>
      </main>
    </div>
  );
}
