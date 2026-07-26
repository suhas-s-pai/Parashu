require("dotenv").config();

const { createClient } = require("@supabase/supabase-js");

const SUPABASE_URL = process.env.SUPABASE_URL;
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const ANON_KEY = process.env.SUPABASE_ANON_KEY;

// The backend writes on behalf of callers who are not Supabase users, so it
// must bypass Row Level Security. The anon key is accepted only as a local
// fallback: with RLS enabled and no policies, every query it makes will fail.
const SUPABASE_KEY = SERVICE_ROLE_KEY || ANON_KEY;

if (!SUPABASE_URL || !SUPABASE_KEY) {
  console.error(
    "Missing Supabase credentials. Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY (or SUPABASE_ANON_KEY) in server/.env"
  );
  process.exit(1);
}

if (!SERVICE_ROLE_KEY) {
  console.warn(
    "Warning: using SUPABASE_ANON_KEY. Row Level Security will reject every query unless it is disabled on sos_alerts."
  );
}

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY, {
  auth: {
    // No end user session exists on the server, and persisting or refreshing
    // one would leak the service role identity between requests.
    persistSession: false,
    autoRefreshToken: false,
    detectSessionInUrl: false,
  },
});

module.exports = supabase;
