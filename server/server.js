require("dotenv").config();
const express = require("express");
const cors = require("cors");
const supabase = require("./supabaseClient");
const invitationStore = require("./invitationStore");

const app = express();

const PORT = process.env.PORT || 5000;

// Columns are selected explicitly so the JSON sent to the client keeps the
// exact shape the frontend expects. The table column is `name`, but the API
// has always returned `user_name`, so PostgREST aliases it back.
const ALERT_COLUMNS =
  "id, user_id, user_name:name, email, phone, latitude, longitude, trigger_type, status, created_at, updated_at";

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const MAX_NAME_LENGTH = 120;
const MAX_PHONE_LENGTH = 32;
const MAX_EMAIL_LENGTH = 254;
const MAX_TRIGGER_LENGTH = 48;

const MIGRATION_HINT =
  "Database is missing a column. Run server/migrations/001_admins_and_emergency_fields.sql in the Supabase SQL editor.";

// Restrict origins in production by setting CORS_ORIGIN to a comma separated
// list. Left unset, behaviour is unchanged from before (any origin).
const allowedOrigins = (process.env.CORS_ORIGIN || "")
  .split(",")
  .map((origin) => origin.trim())
  .filter(Boolean);

app.use(cors(allowedOrigins.length ? { origin: allowedOrigins } : {}));

// Payloads are a handful of short fields; anything larger is abuse, not a caller.
app.use(express.json({ limit: "10kb" }));

const sseClients = new Set();

/* ------------------------------------------------------------------ *
 * Helpers
 * ------------------------------------------------------------------ */

function fail(res, statusCode, message, errorCode) {
  return res.status(statusCode).json({
    success: false,
    message,
    error: errorCode,
  });
}

function isMissingColumn(error) {
  return /column .* does not exist/i.test(error?.message || "");
}

function failFromDatabase(res, context, error, message) {
  console.error(`[${context}]`, error);

  if (isMissingColumn(error)) {
    return fail(res, 500, MIGRATION_HINT, "SCHEMA_OUT_OF_DATE");
  }

  return fail(res, 500, message, "DATABASE_ERROR");
}

function readText(value, label, maxLength) {
  if (typeof value !== "string" || !value.trim()) {
    return { error: `${label} is required` };
  }

  const text = value.trim();

  if (text.length > maxLength) {
    return { error: `${label} must be ${maxLength} characters or fewer` };
  }

  return { value: text };
}

function readCoordinate(value, label, limit) {
  const number = typeof value === "number" ? value : Number(value);

  if (!Number.isFinite(number)) {
    return { error: `${label} must be a number` };
  }

  if (number < -limit || number > limit) {
    return { error: `${label} must be between -${limit} and ${limit}` };
  }

  return { value: number };
}

function readOptionalText(value, maxLength, fallback = "") {
  if (typeof value !== "string") return fallback;
  return value.trim().slice(0, maxLength) || fallback;
}

function readSosPayload(body, authUser) {
  const nameVal =
    body.user_name ||
    authUser?.user_metadata?.full_name ||
    authUser?.user_metadata?.name ||
    authUser?.email ||
    "User";
  const name = readText(nameVal, "user_name", MAX_NAME_LENGTH);
  if (name.error) return { error: name.error };

  const latitude = readCoordinate(body.latitude, "latitude", 90);
  if (latitude.error) return { error: latitude.error };

  const longitude = readCoordinate(body.longitude, "longitude", 180);
  if (longitude.error) return { error: longitude.error };

  const phone = readOptionalText(body.phone, MAX_PHONE_LENGTH, "Not provided");

  return {
    value: {
      name: name.value,
      phone,
      latitude: latitude.value,
      longitude: longitude.value,
      email: readOptionalText(body.email, MAX_EMAIL_LENGTH, authUser?.email || ""),
      trigger_type: readOptionalText(body.trigger_type, MAX_TRIGGER_LENGTH, "Manual SOS"),
    },
  };
}

/* ------------------------------------------------------------------ *
 * Authentication
 *
 * Every route below carries real emergency data — names, phone numbers and
 * the live position of someone in danger. None of it may be readable without
 * a verified Supabase session, so the access token is checked against the
 * auth server on every request rather than trusted from the request body.
 * ------------------------------------------------------------------ */

function readAccessToken(req) {
  const header = req.headers.authorization || "";

  if (header.startsWith("Bearer ")) {
    return header.slice(7).trim();
  }

  // EventSource cannot set headers, so the SSE stream passes its token as a
  // query parameter instead.
  return typeof req.query.access_token === "string" ? req.query.access_token : "";
}

async function requireUser(req, res, next) {
  const token = readAccessToken(req);

  if (!token) {
    return fail(res, 401, "Sign in required", "UNAUTHENTICATED");
  }

  try {
    const { data, error } = await supabase.auth.getUser(token);

    if (error || !data?.user) {
      return fail(res, 401, "Session is invalid or expired", "UNAUTHENTICATED");
    }

    req.authUser = data.user;
    return next();
  } catch (err) {
    console.error("[auth] token verification failed", err);
    return fail(res, 401, "Could not verify your session", "UNAUTHENTICATED");
  }
}

async function requireAdmin(req, res, next) {
  return requireUser(req, res, async () => {
    try {
      const { data, error } = await supabase
        .from("admins")
        .select("user_id")
        .eq("user_id", req.authUser.id)
        .maybeSingle();

      if (error) {
        console.error("[auth] admin lookup failed", error);
        return fail(res, 500, "Could not verify administrator access", "DATABASE_ERROR");
      }

      if (!data) {
        return fail(res, 403, "Administrator access required", "FORBIDDEN");
      }

      return next();
    } catch (err) {
      console.error("[auth] admin lookup threw", err);
      return fail(res, 500, "Could not verify administrator access", "INTERNAL_ERROR");
    }
  });
}

/* ------------------------------------------------------------------ *
 * Data access
 * ------------------------------------------------------------------ */

async function getAlertsByStatus(status, limit) {
  let query = supabase
    .from("sos_alerts")
    .select(ALERT_COLUMNS)
    .eq("status", status)
    .order("created_at", { ascending: false });

  if (limit) {
    query = query.limit(limit);
  }

  const { data, error } = await query;

  if (error) {
    throw error;
  }

  return data || [];
}

const getActiveAlerts = () => getAlertsByStatus("active");

// The control room history panel. Capped so a long lived deployment cannot
// return an unbounded payload to the browser.
const getResolvedAlerts = () => getAlertsByStatus("handled", 100);

function broadcastUpdate(alerts) {
  const payload = JSON.stringify({ alerts });
  for (const client of sseClients) {
    client.write(`event: update\ndata: ${payload}\n\n`);
  }
}

async function broadcastActiveAlerts() {
  const alerts = await getActiveAlerts();
  broadcastUpdate(alerts);
  return alerts;
}

async function setupRealtime() {
  const channel = supabase.channel("parashu-alerts");

  channel.on(
    "postgres_changes",
    { event: "*", schema: "public", table: "sos_alerts" },
    async () => {
      try {
        await broadcastActiveAlerts();
      } catch (error) {
        console.error("[realtime] failed to broadcast", error);
      }
    }
  );

  channel.subscribe((status) => {
    console.log(`[realtime] ${status}`);
  });
}

/* ------------------------------------------------------------------ *
 * Routes
 * ------------------------------------------------------------------ */

app.get("/", (req, res) => {
  res.send("Parashu backend running");
});

// Control room feed. Admin only — this streams live positions.
app.get("/alerts/stream", requireAdmin, async (req, res) => {
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache, no-transform");
  res.setHeader("Connection", "keep-alive");
  res.flushHeaders?.();

  const client = res;
  sseClients.add(client);

  res.write(`event: connected\ndata: ${JSON.stringify({ status: "connected" })}\n\n`);

  try {
    const alerts = await getActiveAlerts();
    res.write(`event: snapshot\ndata: ${JSON.stringify({ alerts })}\n\n`);
  } catch (error) {
    console.error("[alerts/stream] initial snapshot failed", error);
    res.write(`event: error\ndata: ${JSON.stringify({ message: "Unable to load alerts" })}\n\n`);
  }

  req.on("close", () => {
    sseClients.delete(client);
  });
});

// Raise an emergency, or update the position of one already open.
app.post("/sos", requireUser, async (req, res) => {
  const payload = readSosPayload(req.body || {}, req.authUser);

  if (payload.error) {
    return fail(res, 400, payload.error, "VALIDATION_ERROR");
  }

  const { name, phone, latitude, longitude, email, trigger_type } = payload.value;
  const userId = req.authUser.id;

  try {
    let updateQuery = supabase
      .from("sos_alerts")
      .update({ latitude, longitude, updated_at: new Date().toISOString() }, { count: "exact" })
      .eq("status", "active");

    if (phone && phone !== "Not provided") {
      updateQuery = updateQuery.or(`user_id.eq.${userId},phone.eq.${phone}`);
    } else {
      updateQuery = updateQuery.eq("user_id", userId);
    }

    const { count, error: updateError } = await updateQuery;

    if (updateError) {
      return failFromDatabase(res, "POST /sos update", updateError, "Update error");
    }

    if (count > 0) {
      await broadcastActiveAlerts();
      return res.json({ message: "Location updated" });
    }

    const { error: insertError } = await supabase.from("sos_alerts").insert({
      user_id: userId,
      name,
      email: email || req.authUser.email || "",
      phone,
      latitude,
      longitude,
      trigger_type,
    });

    if (insertError) {
      if (insertError.code === "23505") {
        await broadcastActiveAlerts();
        return res.json({ message: "Location updated" });
      }

      return failFromDatabase(res, "POST /sos insert", insertError, "Insert error");
    }

    await broadcastActiveAlerts();
    return res.json({ message: "SOS alert created" });
  } catch (err) {
    return failFromDatabase(res, "POST /sos", err, "Database error");
  }
});

app.get("/alerts", requireAdmin, async (req, res) => {
  try {
    res.json(await getActiveAlerts());
  } catch (err) {
    return failFromDatabase(res, "GET /alerts", err, "Database error");
  }
});

app.get("/alerts/history", requireAdmin, async (req, res) => {
  try {
    res.json(await getResolvedAlerts());
  } catch (err) {
    return failFromDatabase(res, "GET /alerts/history", err, "Database error");
  }
});

app.delete("/alerts/history", requireAdmin, async (req, res) => {
  try {
    const { count, error } = await supabase
      .from("sos_alerts")
      .delete({ count: "exact" })
      .eq("status", "handled");

    if (error) {
      return failFromDatabase(res, "DELETE /alerts/history", error, "Database error");
    }

    res.json({
      success: true,
      deletedCount: count || 0,
      message: `${count || 0} resolved history records deleted successfully`,
    });
  } catch (err) {
    return failFromDatabase(res, "DELETE /alerts/history", err, "Database error");
  }
});

app.delete("/alerts/:id", requireAdmin, async (req, res) => {
  const { id } = req.params;

  if (!UUID_PATTERN.test(id)) {
    return fail(res, 400, "Invalid alert id", "VALIDATION_ERROR");
  }

  try {
    const { error } = await supabase
      .from("sos_alerts")
      .update({ status: "handled" })
      .eq("id", id)
      .eq("status", "active");

    if (error) {
      return failFromDatabase(res, "DELETE /alerts/:id", error, "Database error");
    }

    await broadcastActiveAlerts();
    res.json({ message: "Alert handled and removed" });
  } catch (err) {
    return failFromDatabase(res, "DELETE /alerts/:id", err, "Database error");
  }
});

/* ------------------------------------------------------------------ *
 * Admin Management Routes
 * ------------------------------------------------------------------ */

app.get("/admins", requireAdmin, async (req, res) => {
  try {
    const { data: adminRows, error: adminErr } = await supabase
      .from("admins")
      .select("user_id, email, created_at")
      .order("created_at", { ascending: true });

    if (adminErr) {
      return failFromDatabase(res, "GET /admins", adminErr, "Database error");
    }

    let authUsersMap = new Map();
    try {
      const { data: userData } = await supabase.auth.admin.listUsers();
      if (userData?.users) {
        for (const u of userData.users) {
          authUsersMap.set(u.id, u);
        }
      }
    } catch (e) {
      console.warn("[GET /admins] listUsers fallback:", e?.message);
    }

    const admins = (adminRows || []).map((row) => {
      const authUser = authUsersMap.get(row.user_id);
      const meta = authUser?.user_metadata || {};
      const name = meta.full_name || meta.name || row.email.split("@")[0] || "Administrator";
      return {
        user_id: row.user_id,
        email: row.email,
        name,
        created_at: row.created_at,
        provider: authUser?.app_metadata?.provider || "email",
      };
    });

    return res.json(admins);
  } catch (err) {
    return failFromDatabase(res, "GET /admins", err, "Server error");
  }
});

app.post("/admins", requireAdmin, async (req, res) => {
  const { name, email, password } = req.body || {};

  if (!name || typeof name !== "string" || !name.trim()) {
    return fail(res, 400, "Administrator name is required", "VALIDATION_ERROR");
  }

  if (!email || typeof email !== "string" || !email.includes("@")) {
    return fail(res, 400, "A valid email address is required", "VALIDATION_ERROR");
  }

  if (!password || typeof password !== "string" || password.length < 6) {
    return fail(res, 400, "Password must be at least 6 characters long", "VALIDATION_ERROR");
  }

  const cleanName = name.trim();
  const cleanEmail = email.trim().toLowerCase();

  try {
    const { data: createData, error: createErr } = await supabase.auth.admin.createUser({
      email: cleanEmail,
      password,
      email_confirm: true,
      user_metadata: { full_name: cleanName, name: cleanName },
    });

    if (createErr) {
      return fail(
        res,
        400,
        createErr.message || "Could not create user account in Supabase Auth",
        "AUTH_ERROR"
      );
    }

    const userId = createData.user.id;

    const { error: insertErr } = await supabase.from("admins").insert({
      user_id: userId,
      email: cleanEmail,
    });

    if (insertErr) {
      return failFromDatabase(res, "POST /admins insert", insertErr, "Database error");
    }

    return res.json({
      success: true,
      admin: {
        user_id: userId,
        email: cleanEmail,
        name: cleanName,
        created_at: new Date().toISOString(),
      },
    });
  } catch (err) {
    return failFromDatabase(res, "POST /admins", err, "Server error");
  }
});

app.delete("/admins/:id", requireAdmin, async (req, res) => {
  const { id } = req.params;

  if (!UUID_PATTERN.test(id)) {
    return fail(res, 400, "Invalid administrator id", "VALIDATION_ERROR");
  }

  try {
    const { count, error: countErr } = await supabase
      .from("admins")
      .select("user_id", { count: "exact", head: true });

    if (countErr) {
      return failFromDatabase(res, "DELETE /admins count", countErr, "Database error");
    }

    if (count <= 1) {
      return fail(
        res,
        400,
        "Cannot remove the last remaining administrator account.",
        "FORBIDDEN"
      );
    }

    const { error: deleteRowErr } = await supabase
      .from("admins")
      .delete()
      .eq("user_id", id);

    if (deleteRowErr) {
      return failFromDatabase(res, "DELETE /admins row", deleteRowErr, "Database error");
    }

    try {
      await supabase.auth.admin.deleteUser(id);
    } catch (e) {
      console.warn("[DELETE /admins] auth deleteUser warning:", e?.message);
    }

    return res.json({
      success: true,
      message: "Administrator removed successfully",
    });
  } catch (err) {
    return failFromDatabase(res, "DELETE /admins", err, "Server error");
  }
});

// Polled by the person who raised the alert, to learn when it was closed.
app.get("/alert-status/:phone", requireUser, async (req, res) => {
  const phone = readText(req.params.phone, "phone", MAX_PHONE_LENGTH);

  if (phone.error) {
    return fail(res, 400, phone.error, "VALIDATION_ERROR");
  }

  try {
    const { data, error } = await supabase
      .from("sos_alerts")
      .select("status")
      .eq("phone", phone.value)
      .order("created_at", { ascending: false })
      .limit(1);

    if (error) {
      return failFromDatabase(res, "GET /alert-status/:phone", error, "Database error");
    }

    if (data.length === 0) {
      return res.json({ status: "active" });
    }

    res.json(data[0]);
  } catch (err) {
    return failFromDatabase(res, "GET /alert-status/:phone", err, "Database error");
  }
});

app.use((req, res) => {
  fail(res, 404, "Route not found", "NOT_FOUND");
});

app.use((err, req, res, next) => {
  if (err.type === "entity.parse.failed" || err instanceof SyntaxError) {
    console.warn(`[${req.method} ${req.path}] invalid JSON body`);
    return fail(res, 400, "Invalid JSON body", "VALIDATION_ERROR");
  }

  if (err.type === "entity.too.large") {
    console.warn(`[${req.method} ${req.path}] body too large`);
    return fail(res, 413, "Request body too large", "PAYLOAD_TOO_LARGE");
  }

  console.error("[unhandled]", err);
  fail(res, 500, "Unexpected server error", "INTERNAL_ERROR");
});

/* ------------------------------------------------------------------ *
 * Admin Invitation & Request Routes
 * ------------------------------------------------------------------ */

app.post("/admin-invitations/generate", requireAdmin, async (req, res) => {
  try {
    const invitation = invitationStore.createInvitation(req.authUser?.id);
    return res.json({ success: true, invitation });
  } catch (err) {
    return fail(res, 500, "Could not generate admin invitation", "SERVER_ERROR");
  }
});

app.get("/admin-invitations/verify/:token", async (req, res) => {
  const { token } = req.params;
  try {
    const result = invitationStore.getInvitation(token);
    return res.json(result);
  } catch (err) {
    return res.json({ valid: false, error: "VERIFICATION_FAILED" });
  }
});

app.post("/admin-invitations/submit-request", async (req, res) => {
  const { token, name, email, password } = req.body || {};

  if (!token || typeof token !== "string") {
    return fail(res, 400, "Invitation token is required", "VALIDATION_ERROR");
  }

  if (!name || typeof name !== "string" || !name.trim()) {
    return fail(res, 400, "Full Name is required", "VALIDATION_ERROR");
  }

  if (!email || typeof email !== "string" || !email.includes("@")) {
    return fail(res, 400, "A valid email address is required", "VALIDATION_ERROR");
  }

  if (!password || typeof password !== "string" || password.length < 6) {
    return fail(res, 400, "Password must be at least 6 characters long", "VALIDATION_ERROR");
  }

  try {
    const result = invitationStore.submitRequest(token, name, email, password);

    if (!result.success) {
      const errMap = {
        INVITATION_EXPIRED: "This invitation has expired (valid for 5 minutes). Ask an administrator to generate a new QR code invitation.",
        INVITATION_ALREADY_USED: "This invitation has already been used.",
        INVITATION_NOT_FOUND: "Invalid invitation token.",
      };
      return fail(
        res,
        400,
        errMap[result.error] || "Invalid or expired invitation token.",
        result.error
      );
    }

    return res.json({
      success: true,
      message: "Admin request submitted successfully. An existing administrator must approve your request before you can log in.",
    });
  } catch (err) {
    return fail(res, 500, "Could not submit admin request", "SERVER_ERROR");
  }
});

app.get("/admin-requests", requireAdmin, async (req, res) => {
  try {
    const requests = invitationStore.getPendingRequests();
    return res.json(requests);
  } catch (err) {
    return fail(res, 500, "Could not fetch pending admin requests", "SERVER_ERROR");
  }
});

app.post("/admin-requests/:id/approve", requireAdmin, async (req, res) => {
  const { id } = req.params;

  try {
    const pendingReq = invitationStore.getRequestById(id);

    if (!pendingReq || pendingReq.status !== "pending") {
      return fail(res, 404, "Pending admin request not found", "NOT_FOUND");
    }

    // Create user in Supabase Auth using the requested credentials
    const { data: createData, error: createErr } = await supabase.auth.admin.createUser({
      email: pendingReq.email,
      password: pendingReq.plain_password,
      email_confirm: true,
      user_metadata: { full_name: pendingReq.name, name: pendingReq.name },
    });

    if (createErr && !createErr.message?.includes("already been registered")) {
      return fail(
        res,
        400,
        createErr.message || "Could not create user account in Supabase Auth",
        "AUTH_ERROR"
      );
    }

    let userId = createData?.user?.id;

    // If user already exists in auth, look up user ID from listUsers
    if (!userId) {
      const { data: listData } = await supabase.auth.admin.listUsers();
      const existingUser = listData?.users?.find(
        (u) => u.email?.toLowerCase() === pendingReq.email.toLowerCase()
      );
      if (existingUser) {
        userId = existingUser.id;
      }
    }

    if (!userId) {
      return fail(res, 500, "Could not locate user ID for admin account", "SERVER_ERROR");
    }

    // Insert user into public.admins table
    const { error: insertErr } = await supabase.from("admins").insert({
      user_id: userId,
      email: pendingReq.email,
    });

    if (insertErr && !insertErr.message?.includes("duplicate key")) {
      return failFromDatabase(res, "POST /admin-requests/:id/approve insert", insertErr, "Database error");
    }

    invitationStore.updateRequestStatus(id, "approved");

    return res.json({
      success: true,
      message: `${pendingReq.name} (${pendingReq.email}) has been approved as an administrator.`,
    });
  } catch (err) {
    return fail(res, 500, "Could not approve admin request", "SERVER_ERROR");
  }
});

app.post("/admin-requests/:id/reject", requireAdmin, async (req, res) => {
  const { id } = req.params;

  try {
    const pendingReq = invitationStore.getRequestById(id);

    if (!pendingReq || pendingReq.status !== "pending") {
      return fail(res, 404, "Pending admin request not found", "NOT_FOUND");
    }

    invitationStore.updateRequestStatus(id, "rejected");

    return res.json({
      success: true,
      message: `Admin request for ${pendingReq.email} has been rejected.`,
    });
  } catch (err) {
    return fail(res, 500, "Could not reject admin request", "SERVER_ERROR");
  }
});

async function checkDatabase() {
  const { error } = await supabase.from("sos_alerts").select(ALERT_COLUMNS).limit(1);

  if (!error) {
    console.log("Supabase connected — sos_alerts ready");
  } else if (isMissingColumn(error)) {
    console.error(`Supabase connected, but the schema is out of date. ${MIGRATION_HINT}`);
  } else {
    console.error("Supabase connection failed:", error.message);
  }

  const { error: adminsError } = await supabase
    .from("admins")
    .select("user_id", { count: "exact", head: true });

  if (adminsError) {
    console.error(
      `admins table unavailable (${adminsError.message}). Control room access will be refused until the migration runs.`
    );
  } else {
    console.log("admins table ready");
  }
}

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
  checkDatabase();
  setupRealtime().catch((error) => {
    console.error("Realtime setup failed", error);
  });
});
