-- Parashu — Supabase (PostgreSQL) schema
-- Run this once in the Supabase dashboard: SQL Editor → New query → Run.
--
-- ALREADY RAN THE EARLIER VERSION OF THIS FILE?
-- The primary key changed from bigint to uuid, so the table must be recreated.
-- If it holds no data you care about:
--     drop table if exists public.sos_alerts cascade;
-- then run everything below. If it does hold data, migrate instead — do not
-- drop a table containing real emergency records.

create table if not exists public.sos_alerts (
  id          uuid        primary key default gen_random_uuid(),
  name        text        not null,
  phone       text        not null,
  latitude    double precision not null,
  longitude   double precision not null,
  status      text        not null default 'active',
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),

  constraint sos_alerts_status_check
    check (status in ('active', 'handled')),
  constraint sos_alerts_latitude_check
    check (latitude between -90 and 90),
  constraint sos_alerts_longitude_check
    check (longitude between -180 and 180)
);


-- Indexes ------------------------------------------------------------------

-- GET /alerts: filter on status, sort by created_at.
create index if not exists sos_alerts_status_created_at_idx
  on public.sos_alerts (status, created_at desc);

-- GET /alert-status/:phone: newest row for one caller.
create index if not exists sos_alerts_phone_created_at_idx
  on public.sos_alerts (phone, created_at desc);

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
