-- Parashu — migration 001
-- Adds the emergency fields the control room needs, plus the admin table.
--
-- Safe to run on a database that already holds alerts: every statement is
-- additive and idempotent. No existing row is deleted or rewritten.
--
-- Run once: Supabase dashboard → SQL Editor → New query → paste → Run.


/* ------------------------------------------------------------------ *
 * 1. sos_alerts — link an alert to the account that raised it
 * ------------------------------------------------------------------ */

-- Who raised it. Nullable so alerts created before this migration stay valid,
-- and "set null" so deleting an account never destroys the emergency record.
alter table public.sos_alerts
  add column if not exists user_id uuid references auth.users (id) on delete set null;

alter table public.sos_alerts
  add column if not exists email text;

alter table public.sos_alerts
  add column if not exists trigger_type text not null default 'Manual SOS';

create index if not exists sos_alerts_user_id_idx
  on public.sos_alerts (user_id);


/* ------------------------------------------------------------------ *
 * 2. admins — who may open the control room
 * ------------------------------------------------------------------ */

-- Membership only. Passwords, sessions and email confirmation stay entirely
-- inside Supabase Auth, so no credential is ever stored by this application.
create table if not exists public.admins (
  user_id     uuid        primary key references auth.users (id) on delete cascade,
  email       text        not null,
  created_at  timestamptz not null default now()
);

alter table public.admins enable row level security;

-- A signed-in account may check whether it is itself an admin, and nothing
-- else. The row for any other account stays invisible, so the table cannot be
-- enumerated with the publishable key.
drop policy if exists "admins read own row" on public.admins;

create policy "admins read own row"
  on public.admins
  for select
  to authenticated
  using (auth.uid() = user_id);

-- No insert/update/delete policy exists on purpose: admins are granted from
-- the SQL editor or by the backend's service role key, never from the browser.


/* ------------------------------------------------------------------ *
 * 3. Grant your first admin
 * ------------------------------------------------------------------ */

-- Step 1 — create the account in Supabase → Authentication → Users →
--          "Add user" → enter an email and password. Supabase hashes and
--          stores the password; this project never sees it.
--
-- Step 2 — uncomment the statement below, set the email to that account's
--          address, and run it.
--
-- insert into public.admins (user_id, email)
-- select id, email from auth.users where email = 'admin@yourdomain.com'
-- on conflict (user_id) do nothing;
