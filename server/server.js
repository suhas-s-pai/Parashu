require("dotenv").config();
const express = require("express");
const cors = require("cors");
const supabase = require("./supabaseClient");

const app = express();

const PORT = process.env.PORT || 5000;

// Columns are selected explicitly so the JSON sent to the client keeps the
// exact shape the frontend already expects. The table column is `name`, but
// the API has always returned `user_name`, so PostgREST aliases it back.
const ALERT_COLUMNS =
  "id, user_name:name, phone, latitude, longitude, status, created_at, updated_at";
const ALERT_COLUMNS_WITH_META = `${ALERT_COLUMNS}, email, trigger_type`;

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const MAX_NAME_LENGTH = 120;
const MAX_PHONE_LENGTH = 32;

// Restrict origins in production by setting CORS_ORIGIN to a comma separated
// list. Left unset, behaviour is unchanged from before (any origin).
const allowedOrigins = (process.env.CORS_ORIGIN || "")
  .split(",")
  .map((origin) => origin.trim())
  .filter(Boolean);

app.use(cors(allowedOrigins.length ? { origin: allowedOrigins } : {}));

// Payloads are four short fields; anything larger is abuse, not a caller.
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

function failFromDatabase(res, context, error, message) {
  console.error(`[${context}]`, error);
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

function readSosPayload(body) {
  const name = readText(body.user_name, "user_name", MAX_NAME_LENGTH);
  if (name.error) return { error: name.error };

  const phone = readText(body.phone, "phone", MAX_PHONE_LENGTH);
  if (phone.error) return { error: phone.error };

  const latitude = readCoordinate(body.latitude, "latitude", 90);
  if (latitude.error) return { error: latitude.error };

  const longitude = readCoordinate(body.longitude, "longitude", 180);
  if (longitude.error) return { error: longitude.error };

  const email = typeof body.email === "string" ? body.email.trim() : "";
  const triggerType = typeof body.trigger_type === "string" ? body.trigger_type.trim() : "Manual SOS";

  return {
    value: {
      name: name.value,
      phone: phone.value,
      latitude: latitude.value,
      longitude: longitude.value,
      email,
      trigger_type: triggerType,
    },
  };
}

async function getActiveAlerts() {
  const attempts = [
    { columns: ALERT_COLUMNS_WITH_META, fallback: false },
    { columns: ALERT_COLUMNS, fallback: true },
  ];

  for (const attempt of attempts) {
    const { data, error } = await supabase
      .from("sos_alerts")
      .select(attempt.columns)
      .eq("status", "active")
      .order("created_at", { ascending: false });

    if (!error) {
      return (data || []).map((row) => ({
        ...row,
        user_name: row.user_name || row.name || "Unknown",
        email: row.email || "",
        trigger_type: row.trigger_type || "Manual SOS",
      }));
    }

    const message = error.message || "";
    if (!attempt.fallback && /column .* does not exist/i.test(message)) {
      continue;
    }

    throw error;
  }

  return [];
}

async function insertAlert(payload) {
  const basePayload = {
    name: payload.name,
    phone: payload.phone,
    latitude: payload.latitude,
    longitude: payload.longitude,
  };

  const optionalPayload = {};
  if (payload.email) {
    optionalPayload.email = payload.email;
  }
  if (payload.trigger_type) {
    optionalPayload.trigger_type = payload.trigger_type;
  }

  const { error } = await supabase.from("sos_alerts").insert({ ...basePayload, ...optionalPayload });

  if (error && /column .* does not exist/i.test(error.message || "")) {
    return supabase.from("sos_alerts").insert(basePayload);
  }

  return { error };
}

function broadcastUpdate(alerts) {
  const payload = JSON.stringify({ alerts });
  for (const client of sseClients) {
    client.write(`event: update\ndata: ${payload}\n\n`);
  }
}

async function setupRealtime() {
  const channel = supabase.channel("parashu-alerts");

  channel.on(
    "postgres_changes",
    { event: "*", schema: "public", table: "sos_alerts" },
    async () => {
      try {
        const alerts = await getActiveAlerts();
        broadcastUpdate(alerts);
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

app.get("/alerts/stream", async (req, res) => {
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

app.post("/sos", async (req, res) => {
  const payload = readSosPayload(req.body || {});

  if (payload.error) {
    return fail(res, 400, payload.error, "VALIDATION_ERROR");
  }

  const { name, phone, latitude, longitude, email, trigger_type } = payload.value;

  try {
    const { count, error: updateError } = await supabase
      .from("sos_alerts")
      .update({ latitude, longitude }, { count: "exact" })
      .eq("phone", phone)
      .eq("status", "active");

    if (updateError) {
      return failFromDatabase(res, "POST /sos update", updateError, "Update error");
    }

    if (count > 0) {
      const alerts = await getActiveAlerts();
      broadcastUpdate(alerts);
      return res.json({ message: "Location updated" });
    }

    const { error: insertError } = await insertAlert({ name, phone, latitude, longitude, email, trigger_type });

    if (insertError) {
      if (insertError.code === "23505") {
        const alerts = await getActiveAlerts();
        broadcastUpdate(alerts);
        return res.json({ message: "Location updated" });
      }

      return failFromDatabase(res, "POST /sos insert", insertError, "Insert error");
    }

    const alerts = await getActiveAlerts();
    broadcastUpdate(alerts);
    return res.json({ message: "SOS alert created" });
  } catch (err) {
    return failFromDatabase(res, "POST /sos", err, "Database error");
  }
});

app.get("/alerts", async (req, res) => {
  try {
    const alerts = await getActiveAlerts();
    res.json(alerts);
  } catch (err) {
    return failFromDatabase(res, "GET /alerts", err, "Database error");
  }
});

app.delete("/alerts/:id", async (req, res) => {
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

    const alerts = await getActiveAlerts();
    broadcastUpdate(alerts);
    res.json({ message: "Alert handled and removed" });
  } catch (err) {
    return failFromDatabase(res, "DELETE /alerts/:id", err, "Database error");
  }
});

app.get("/alert-status/:phone", async (req, res) => {
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

async function checkDatabase() {
  const { error } = await supabase
    .from("sos_alerts")
    .select("id", { count: "exact", head: true });

  if (error) {
    console.error("Supabase connection failed:", error.message);
  } else {
    console.log("Supabase Connected");
    console.log("sos_alerts table ready");
  }
}

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
  checkDatabase();
  setupRealtime().catch((error) => {
    console.error("Realtime setup failed", error);
  });
});
