import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import { BrowserRouter } from "react-router-dom";
import { AuthProvider } from "./lib/AuthProvider";
import "./styles.css";

class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error) {
    return { hasError: true, error };
  }

  componentDidCatch(error, errorInfo) {
    console.error("[Parashu ErrorBoundary] Uncaught runtime error:", error, errorInfo);
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="ks-boot" style={{ background: "#0B1220", color: "#f8fafc" }}>
          <div className="ks-boot__mark" style={{ background: "#ef4444" }}>⚠️</div>
          <strong>Parashu Application Error</strong>
          <p style={{ color: "#94a3b8" }}>
            {this.state.error?.message || "An unexpected error occurred while loading the application."}
          </p>
          <button
            type="button"
            className="pa-btn pa-btn--primary"
            style={{ marginTop: 16 }}
            onClick={() => window.location.reload()}
          >
            Reload Application
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}

ReactDOM.createRoot(document.getElementById("root")).render(
  <React.StrictMode>
    <ErrorBoundary>
      <BrowserRouter>
        <AuthProvider>
          <App />
        </AuthProvider>
      </BrowserRouter>
    </ErrorBoundary>
  </React.StrictMode>
);
