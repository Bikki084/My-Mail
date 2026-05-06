-- MyMail SaaS — outbound IP rotation + pause/resume
--
-- Production setup (deploy with a real proxy/VPS rotation provider):
--   * `user_outbound_ip` stores each user's current exit IP, lease expiry,
--     and how many successful sends are allowed per IP burst.
--   * The send loop reads this row, snapshots the IP onto the campaign, and
--     pauses the campaign when the burst threshold is reached. The UI is then
--     responsible for asking the user to rotate the IP and call the resume
--     endpoint, which picks up exactly where the pause happened.
--
-- The migration is purely additive and idempotent: existing campaigns keep
-- working unchanged because the new fields are nullable / default to zero.

-------------------------------------------------------------------------------
-- 1) Per-user outbound IP and rotation policy
-------------------------------------------------------------------------------

create table if not exists public.user_outbound_ip (
  user_id uuid primary key references public.profiles (id) on delete cascade,
  current_ip text,
  -- When the lease for `current_ip` ends (UI hint; not enforced by the worker).
  expires_at timestamptz,
  -- Pause the campaign after this many successful sends per IP burst. Default
  -- 1000 lines up with the deliverability rule of thumb cited in the spec.
  rotation_threshold integer not null default 1000
    check (rotation_threshold > 0 and rotation_threshold <= 100000),
  updated_at timestamptz not null default now()
);

-------------------------------------------------------------------------------
-- 2) IP rotation state on campaigns
-------------------------------------------------------------------------------

alter table public.campaigns
  add column if not exists ip_rotation_threshold integer,
  add column if not exists pause_reason text,
  add column if not exists paused_at timestamptz,
  add column if not exists current_outbound_ip text,
  add column if not exists outbound_ip_history jsonb not null default '[]'::jsonb;

-- `pause_reason` is free-form text today; only `'rotate_ip'` is produced by
-- the app, but other reasons (manual pause, plan-expired, etc.) might be
-- added later, so we deliberately keep this loose.

-------------------------------------------------------------------------------
-- 3) RLS — clients can read/write only their own row
-------------------------------------------------------------------------------

alter table public.user_outbound_ip enable row level security;

drop policy if exists "user_outbound_ip_select" on public.user_outbound_ip;
create policy "user_outbound_ip_select"
  on public.user_outbound_ip for select
  using (auth.uid() = user_id);

drop policy if exists "user_outbound_ip_insert" on public.user_outbound_ip;
create policy "user_outbound_ip_insert"
  on public.user_outbound_ip for insert
  with check (auth.uid() = user_id);

drop policy if exists "user_outbound_ip_update" on public.user_outbound_ip;
create policy "user_outbound_ip_update"
  on public.user_outbound_ip for update
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);
