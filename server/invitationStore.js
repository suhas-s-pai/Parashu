const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const DATA_DIR = path.join(__dirname, "data");
const DATA_FILE = path.join(DATA_DIR, "invitations.json");

// Ensure data directory exists
if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}

// In-memory cache synced with disk
let store = {
  invitations: {}, // token -> { id, token, created_by_admin, expires_at, status, created_at }
  requests: {},    // requestId -> { id, token_id, name, email, password_hash, status, created_at, approved_at }
};

function loadStore() {
  try {
    if (fs.existsSync(DATA_FILE)) {
      const content = fs.readFileSync(DATA_FILE, "utf-8");
      const parsed = JSON.parse(content);
      store = {
        invitations: parsed.invitations || {},
        requests: parsed.requests || {},
      };
    }
  } catch (err) {
    console.error("[invitationStore] Error loading storage file:", err);
  }
}

function saveStore() {
  try {
    fs.writeFileSync(DATA_FILE, JSON.stringify(store, null, 2), "utf-8");
  } catch (err) {
    console.error("[invitationStore] Error saving storage file:", err);
  }
}

// Load on startup
loadStore();

function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString("hex");
  const hash = crypto.scryptSync(password, salt, 64).toString("hex");
  return `${salt}:${hash}`;
}

function createInvitation(adminId) {
  const token = crypto.randomBytes(24).toString("hex");
  const now = Date.now();
  const expiresAt = now + 5 * 60 * 1000; // Exactly 5 minutes server-side

  const invitation = {
    id: crypto.randomUUID(),
    token,
    created_by_admin: adminId || null,
    created_at: new Date(now).toISOString(),
    expires_at: expiresAt,
    status: "active", // active | requested | expired
  };

  store.invitations[token] = invitation;
  saveStore();
  return invitation;
}

function getInvitation(token) {
  if (!token || !store.invitations[token]) {
    return { error: "INVITATION_NOT_FOUND", valid: false };
  }

  const inv = store.invitations[token];
  const now = Date.now();

  if (now > inv.expires_at || inv.status === "expired") {
    inv.status = "expired";
    saveStore();
    return { error: "INVITATION_EXPIRED", valid: false, invitation: inv };
  }

  if (inv.status !== "active") {
    return { error: "INVITATION_ALREADY_USED", valid: false, invitation: inv };
  }

  const remainingSeconds = Math.max(0, Math.floor((inv.expires_at - now) / 1000));
  return { valid: true, invitation: inv, remainingSeconds };
}

function submitRequest(token, name, email, password) {
  const check = getInvitation(token);
  if (!check.valid) {
    return { success: false, error: check.error };
  }

  const inv = check.invitation;
  const requestId = crypto.randomUUID();
  const passwordHash = hashPassword(password);

  const request = {
    id: requestId,
    invitation_id: inv.id,
    token: inv.token,
    name: name.trim(),
    email: email.trim().toLowerCase(),
    password_hash: passwordHash,
    plain_password: password, // kept transiently in-memory for Supabase Auth account creation upon admin approval
    status: "pending", // pending | approved | rejected
    created_at: new Date().toISOString(),
    approved_at: null,
  };

  // Mark invitation as requested (single use)
  inv.status = "requested";
  store.requests[requestId] = request;
  saveStore();

  return { success: true, request };
}

function getPendingRequests() {
  const now = Date.now();
  return Object.values(store.requests)
    .filter((req) => req.status === "pending")
    .map((req) => ({
      id: req.id,
      name: req.name,
      email: req.email,
      status: req.status,
      created_at: req.created_at,
    }))
    .sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
}

function getRequestById(id) {
  return store.requests[id] || null;
}

function updateRequestStatus(id, status) {
  if (!store.requests[id]) return false;
  store.requests[id].status = status;
  if (status === "approved") {
    store.requests[id].approved_at = new Date().toISOString();
  }
  // Sanitize transient plain text password from store
  delete store.requests[id].plain_password;
  saveStore();
  return true;
}

module.exports = {
  createInvitation,
  getInvitation,
  submitRequest,
  getPendingRequests,
  getRequestById,
  updateRequestStatus,
};
