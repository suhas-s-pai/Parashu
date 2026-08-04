-- Parashu — Supabase (PostgreSQL) schema
-- Run this once in the Supabase dashboard: SQL Editor → New query → Run.
--
-- This is the full current shape for a fresh project. An existing database
-- created from the earlier version of this file should run
-- migrations/001_admins_and_emergency_fields.sql instead, which adds the same
-- columns without touching existing rows.
--
-- ALREADY RAN THE EARLIER VERSION OF THIS FILE?
-- The primary key changed from bigint to uuid, so the table must be recreated.
-- If it holds no data you care about:
--     drop table if exists public.sos_alerts cascade;
-- then run everything below. If it does hold data, migrate instead — do not
-- drop a table containing real emergency records.

create table if not exists public.sos_alerts (
  id            uuid        primary key default gen_random_uuid(),
  -- The account that raised the alert. Nullable so historical rows stay valid;
  -- "set null" so closing an account never destroys the emergency record.
  user_id       uuid        references auth.users (id) on delete set null,
  name          text        not null,
  email         text,
  phone         text        not null,
  latitude      double precision not null,
  longitude     double precision not null,
  trigger_type  text        not null default 'Manual SOS',
  status        text        not null default 'active',
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),

  constraint sos_alerts_status_check
    check (status in ('active', 'handled')),
  constraint sos_alerts_latitude_check
    check (latitude between -90 and 90),
  constraint sos_alerts_longitude_check
    check (longitude between -180 and 180)
);


-- Who may open the control room. Membership only — passwords and sessions
-- stay inside Supabase Auth, so no credential is stored by this application.
create table if not exists public.admins (
  user_id     uuid        primary key references auth.users (id) on delete cascade,
  email       text        not null,
  created_at  timestamptz not null default now()
);

alter table public.admins enable row level security;

-- A signed-in account may check whether it is itself an admin, and nothing
-- else — the table cannot be enumerated with the publishable key.
drop policy if exists "admins read own row" on public.admins;

create policy "admins read own row"
  on public.admins
  for select
  to authenticated
  using (auth.uid() = user_id);


-- Indexes ------------------------------------------------------------------

-- GET /alerts: filter on status, sort by created_at.
create index if not exists sos_alerts_status_created_at_idx
  on public.sos_alerts (status, created_at desc);

-- GET /alert-status/:phone: newest row for one caller.
create index if not exists sos_alerts_phone_created_at_idx
  on public.sos_alerts (phone, created_at desc);

-- Alerts raised by one account.
create index if not exists sos_alerts_user_id_idx
  on public.sos_alerts (user_id);

-- POST /sos: one open alert per caller, enforced by the database rather than
-- by application logic. This also serves the lookup on every 5s location ping.
-- Two concurrent pings can no longer create duplicate active alerts.
create unique index if not exists sos_alerts_one_active_per_phone_idx
  on public.sos_alerts (phone)
  where status = 'active';


-- Row Level Security -------------------------------------------------------
-- The backend connects with the service role key, which bypasses RLS.
-- Enabling RLS with zero policies means a leaked anon key still cannot read
-- or write emergency data directly against the Data API.

alter table public.sos_alerts enable row level security;


-- updated_at ---------------------------------------------------------------
-- created_at records when the SOS was first raised and is never touched again.
-- updated_at tracks the newest location ping, maintained here so no endpoint
-- has to remember to set it.

create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  new.created_at = old.created_at;  -- created_at is immutable
  return new;
end;
$$;

drop trigger if exists sos_alerts_set_updated_at on public.sos_alerts;

create trigger sos_alerts_set_updated_at
  before update on public.sos_alerts
  for each row
  execute function public.set_updated_at();
