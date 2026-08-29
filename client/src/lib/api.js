import axios from "axios";
import { supabase } from "./supabaseClient";

// One place for the backend origin. Override per environment with VITE_API_BASE
// instead of editing components.
export const API_BASE = (
  import.meta.env.VITE_API_BASE ||
  (import.meta.env.DEV || (typeof window !== "undefined" && (window.location.hostname === "localhost" || window.location.hostname === "127.0.0.1"))
    ? "http://localhost:5000"
    : "https://parashu-backend.onrender.com")
).replace(/\/+$/, "");

export function getFrontendBaseUrl() {
  const envUrl = import.meta.env.VITE_APP_URL || import.meta.env.VITE_FRONTEND_URL;
  if (envUrl) {
    return envUrl.replace(/\/+$/, "");
  }
  if (typeof window !== "undefined" && window.location.origin) {
    return window.location.origin.replace(/\/+$/, "");
  }
  return "https://parashu-frontend.onrender.com";
}

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

export async function fetchAlertStatus(identifier) {
  if (!identifier) return { status: "handled" };
  const res = await api.get(`/alert-status/${encodeURIComponent(identifier)}`);
  return res.data;
}

export function resolveAlert(id) {
  return api.delete(`/alerts/${id}`);
}

export async function clearResolvedHistory() {
  const res = await api.delete("/alerts/history");
  return res.data;
}

export async function fetchAdmins() {
  const res = await api.get("/admins");
  return res.data || [];
}

export async function createAdmin(payload) {
  const res = await api.post("/admins", payload);
  return res.data;
}

export async function deleteAdmin(id) {
  const res = await api.delete(`/admins/${encodeURIComponent(id)}`);
  return res.data;
}

export async function generateAdminInvitation() {
  const res = await api.post("/admin-invitations/generate");
  return res.data;
}

export async function verifyAdminInvitation(token) {
  const res = await api.get(`/admin-invitations/verify/${encodeURIComponent(token)}`);
  return res.data;
}

export async function submitAdminRequest(payload) {
  const res = await api.post("/admin-invitations/submit-request", payload);
  return res.data;
}

export async function fetchAdminRequests() {
  const res = await api.get("/admin-requests");
  return res.data || [];
}

export async function approveAdminRequest(id) {
  const res = await api.post(`/admin-requests/${encodeURIComponent(id)}/approve`);
  return res.data;
}

export async function rejectAdminRequest(id) {
  const res = await api.post(`/admin-requests/${encodeURIComponent(id)}/reject`);
  return res.data;
}

export async function fetchNearbyHospitals(lat, lon) {
  try {
    const res = await api.get(`/alerts/nearby-hospitals?lat=${lat}&lon=${lon}`);
    return res.data?.hospitals || [];
  } catch (err) {
    console.warn("[api] backend nearby hospitals endpoint failed, using fallback:", err);
    throw err;
  }
}
