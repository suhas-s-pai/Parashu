# Parashu

Women safety emergency response platform. A React + Vite client for the person
raising an alert, and an Express + Supabase backend feeding a control room
console.

- **Client** — `client/` · React 19, Vite, React Router, Supabase Auth
- **Server** — `server/` · Express 5, Supabase (PostgreSQL + Realtime)

## Features

| Area | What it does |
| --- | --- |
| Google sign in | Supabase Auth, session restored on every load |
| Manual SOS | One button, sends name, phone, email and GPS position |
| Voice protection | Web Speech API listens for “help me” / “sos” |
| Live location | Position re-sent every 5s while an alert is open |
| Nearby police / hospitals | OpenStreetMap Overpass API, no key required |
| Control room | Live incident feed over server sent events, embedded OpenStreetMap tracking, resolve to history |

## Setup

```bash
npm run install:all
```

Then create `client/.env` from `client/.env.example`:

```
VITE_SUPABASE_URL=https://your-project-ref.supabase.co
VITE_SUPABASE_ANON_KEY=your-anon-key
```

and `server/.env` from `server/.env.example`:

```
SUPABASE_URL=https://your-project-ref.supabase.co
SUPABASE_SERVICE_ROLE_KEY=your-service-role-key
```

The service role key is **server only**. Nothing prefixed `VITE_` is secret —
Vite inlines those values into the JavaScript bundle the browser downloads.

### Database

A **fresh** project: run `server/schema.sql` once (Supabase dashboard → SQL
Editor → New query → Run).

An **existing** database created from the earlier schema: run
`server/migrations/001_admins_and_emergency_fields.sql` instead. It adds
`user_id`, `email` and `trigger_type` to `sos_alerts` and creates the `admins`
table. Every statement is additive and idempotent — no existing alert is
touched. **The app returns errors until this has run.**

### Sign-in methods to enable

| Method | Where to enable |
| --- | --- |
| Google | Authentication → Providers → Google |
| Name + phone | Authentication → Sign In / Providers → **Anonymous Sign-Ins** → on |
| Administrator | Nothing to enable; email/password is on by default |

Name + phone uses a real Supabase anonymous session rather than a localStorage
flag, so it survives refresh and gives the backend a real user id to attribute
an alert to. With Anonymous Sign-Ins off, that button reports it is disabled.

### Creating an administrator

No credential is ever stored by this project — Supabase Auth owns the password.

1. Authentication → Users → **Add user** → email + password.
2. SQL Editor:

```sql
insert into public.admins (user_id, email)
select id, email from auth.users where email = 'admin@yourdomain.com'
on conflict (user_id) do nothing;
```

That account now lands on `/dashboard` at sign-in. Everyone else lands on Home
and cannot reach the control room.

```bash
npm run dev          # client on http://localhost:5173
npm run dev:server   # server on http://localhost:5000
npm run build        # production build of the client
npm run lint         # eslint over the client
```

By default the client talks to the deployed backend. Set `VITE_API_BASE` in
`client/.env` to develop against a local server.

## Google sign in

Three places have to agree, or Google succeeds and the browser still lands back
on the login screen:

1. **Google Cloud** → Credentials → OAuth client → Authorised redirect URIs
   contains `https://<project-ref>.supabase.co/auth/v1/callback`.
2. **Supabase** → Authentication → Providers → Google is enabled with that
   client ID and secret.
3. **Supabase** → Authentication → URL Configuration → Redirect URLs lists every
   origin the app runs on, including `http://localhost:5173/` and the deployed
   URL. Supabase falls back to the Site URL for anything not listed, so the
   session is created on an origin the app is not open at.

### How the session is held

`client/src/lib/AuthProvider.jsx` is the only place that decides who is signed
in:

- `supabase.auth.getSession()` restores the persisted session on startup,
  including the one Supabase just exchanged out of the OAuth redirect URL.
- `supabase.auth.onAuthStateChange()` keeps it current across sign in, sign out
  and silent token refreshes.
- Routes render only after that first `getSession()` answers, so a signed-in
  operator never sees the login screen flash.

The state change callback stays synchronous. Supabase runs it while holding an
internal lock, so awaiting another Supabase call from inside it deadlocks — the
app never learns it is signed in and stays on the login screen even though
Google succeeded.

Google does not return a phone number, and responders need one, so it is
collected on the Home screen and stored per account on the device. It is
profile data — the Supabase session alone decides whether someone is signed in.

## API authorisation

Every alert endpoint carries real emergency data — names, phone numbers and the
live position of someone in danger — so none of it is readable without a
verified session. The access token travels on each request and the backend
checks it against Supabase Auth rather than trusting the request body.

| Endpoint | Who |
| --- | --- |
| `GET /` | anyone (health check) |
| `POST /sos`, `GET /alert-status/:phone` | any signed-in account |
| `GET /alerts`, `GET /alerts/history`, `GET /alerts/stream`, `DELETE /alerts/:id` | administrators only |

`user_id` on a new alert comes from the verified token, never from the request
body, so an alert cannot be attributed to another account. `EventSource` cannot
send headers, so the stream passes its token as a query parameter.

The React route guards are for navigation only. Typing `/dashboard` or calling
the API directly still returns nothing without an admin session.

> **Deploying:** the client sends tokens as soon as it is rebuilt, but a backend
> still running the previous code ignores them and keeps serving alerts to
> anyone. Redeploy `server/` for the authorisation above to take effect.
