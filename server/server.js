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

/* ------------------------------------------------------------------ *
 * Helpers
 * ------------------------------------------------------------------ */

// Failures use { success, message, error }. Successful responses are left
// exactly as the frontend already expects them.
function fail(res, statusCode, message, errorCode) {
  return res.status(statusCode).json({
    success: false,
    message,
    error: errorCode,
  });
}

// Logs the real cause server side and returns a stable code to the caller.
// Postgres error text can name columns and constraints, which is not
// something an unauthenticated endpoint should hand out.
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

// Deliberately permissive on name and phone: the login screen accepts any
// text, so a stricter rule here would reject existing users and drop a real
// emergency. Coordinates are machine generated and are checked properly.
function readSosPayload(body) {
  const name = readText(body.user_name, "user_name", MAX_NAME_LENGTH);
  if (name.error) return { error: name.error };

  const phone = readText(body.phone, "phone", MAX_PHONE_LENGTH);
  if (phone.error) return { error: phone.error };

  const latitude = readCoordinate(body.latitude, "latitude", 90);
  if (latitude.error) return { error: latitude.error };

  const longitude = readCoordinate(body.longitude, "longitude", 180);
  if (longitude.error) return { error: longitude.error };

  return {
    value: {
      name: name.value,
      phone: phone.value,
      latitude: latitude.value,
      longitude: longitude.value,
    },
  };
}

/* ------------------------------------------------------------------ *
 * Routes
 * ------------------------------------------------------------------ */

// test route
app.get("/", (req, res) => {
  res.send("KaliSOS backend running");
});

// SOS API
app.post("/sos", async (req, res) => {
  const payload = readSosPayload(req.body || {});

  if (payload.error) {
    return fail(res, 400, payload.error, "VALIDATION_ERROR");
  }

  const { name, phone, latitude, longitude } = payload.value;

  try {
    // Tracking sends a ping every 5 seconds, so the update path runs far more
    // often than the insert. Attempting it first makes the common case a
    // single round trip. created_at is left alone; the trigger moves
    // updated_at. A miss returns count 0 and falls through to the insert.
    const { count, error: updateError } = await supabase
      .from("sos_alerts")
      .update({ latitude, longitude }, { count: "exact" })
      .eq("phone", phone)
      .eq("status", "active");

    if (updateError) {
      return failFromDatabase(res, "POST /sos update", updateError, "Update error");
    }

    if (count > 0) {
      return res.json({ message: "Location updated" });
    }

    const { error: insertError } = await supabase
      .from("sos_alerts")
      .insert({ name, phone, latitude, longitude });

    if (insertError) {
      // 23505: the partial unique index rejected a second active alert for
      // this caller, meaning a concurrent request created one microseconds
      // ago. That request carried effectively the same position, so this is
      // a location update, not a failure.
      if (insertError.code === "23505") {
        return res.json({ message: "Location updated" });
      }

      return failFromDatabase(res, "POST /sos insert", insertError, "Insert error");
    }

    return res.json({ message: "SOS alert created" });
  } catch (err) {
    return failFromDatabase(res, "POST /sos", err, "Database error");
  }
});

// NEW API FOR DASHBOARD
app.get("/alerts", async (req, res) => {
  try {
    const { data, error } = await supabase
      .from("sos_alerts")
      .select(ALERT_COLUMNS)
      .eq("status", "active")
      .order("created_at", { ascending: false });

    if (error) {
      return failFromDatabase(res, "GET /alerts", error, "Database error");
    }

    res.json(data);
  } catch (err) {
    return failFromDatabase(res, "GET /alerts", err, "Database error");
  }
});

// DELETE alert (mark as handled)
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

    // Intentionally idempotent. An alert that is already handled, or gone,
    // still reports success: the dashboard's handler has no catch block, so a
    // 404 on a double click would abort its refresh and strand the card.
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
    // Ordered by created_at rather than id: uuids carry no ordering, and the
    // newest SOS is what "latest status" means.
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

/* ------------------------------------------------------------------ *
 * Fallbacks
 * ------------------------------------------------------------------ */

app.use((req, res) => {
  fail(res, 404, "Route not found", "NOT_FOUND");
});

// Malformed JSON reaches here from express.json(); without this Express would
// answer an API caller with an HTML error page.
app.use((err, req, res, next) => {
  // A bad request is the caller's mistake, not a server fault. Log one line
  // for it so real 500s stay findable in the Render logs.
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
 * Startup
 * ------------------------------------------------------------------ */

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
});
