import axios from "axios";
import { supabase } from "./supabaseClient";

// One place for the backend origin. Override per environment with VITE_API_BASE
// instead of editing components.
export const API_BASE = (
  import.meta.env.VITE_API_BASE ||
  (import.meta.env.DEV || (typeof window !== "undefined" && (window.location.hostname === "localhost" || window.location.hostname === "127.0.0.1"))
    ? "http://localhost:5000"
    : "https://kalisos-backend.onrender.com")
).replace(/\/+$/, "");

const api = axios.create({ baseURL: API_BASE, timeout: 15000 });

async function readAccessToken() {
  if (!supabase) return "";

  // Reads the persisted session and refreshes it when close to expiry, so a
  // long lived tab keeps sending a token the backend will still accept.
  const { data } = await supabase.auth.getSession();
  return data?.session?.access_token || "";
}

// The backend verifies this token on every alert endpoint, so it has to travel
// with each request rather than being attached per call site.
api.interceptors.request.use(async (config) => {
  const token = await readAccessToken();

  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }

  return config;
});

/**
 * EventSource cannot set an Authorization header, so the stream carries its
 * token as a query parameter. Async because the token may need refreshing
 * before the connection opens.
 */
export async function getAlertStreamUrl() {
  const token = await readAccessToken();
  return `${API_BASE}/alerts/stream?access_token=${encodeURIComponent(token)}`;
}

export function pingBackend() {
  return api.get("/", { timeout: 8000 });
}

export async function fetchActiveAlerts() {
  const res = await api.get("/alerts");
  return res.data || [];
}

export async function fetchResolvedAlerts() {
  const res = await api.get("/alerts/history");
  return res.data || [];
}

export function sendSos(payload) {
  return api.post("/sos", payload);
}

export async function fetchAlertStatus(phone) {
  const res = await api.get(`/alert-status/${encodeURIComponent(phone)}`);
  return res.data;
}

export function resolveAlert(id) {
  return api.delete(`/alerts/${id}`);
}
