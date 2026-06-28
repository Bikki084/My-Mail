-- Paste this in Supabase Dashboard → SQL Editor → Run
-- if `npm run db:migrate` cannot run on your server (no access token / DB URL).
-- Safe to run multiple times (IF NOT EXISTS / idempotent adds).

-- HTML attachment column (campaign load)
alter table public.campaigns
  add column if not exists html_attachment jsonb;

-- Outbound IP rotation columns (campaign load + send loop)
alter table public.campaigns
  add column if not exists ip_rotation_threshold integer,
  add column if not exists pause_reason text,
  add column if not exists paused_at timestamptz,
  add column if not exists current_outbound_ip text,
  add column if not exists outbound_ip_history jsonb not null default '[]'::jsonb;

-- Surface delivery errors in the UI
alter table public.campaigns
  add column if not exists last_error text;

-- Per-user outbound IP lease (optional metadata; send continues if missing)
create table if not exists public.user_outbound_ip (
  user_id uuid primary key references public.profiles (id) on delete cascade,
  current_ip text,
  expires_at timestamptz,
  rotation_threshold integer not null default 1000
    check (rotation_threshold > 0 and rotation_threshold <= 100000),
  updated_at timestamptz not null default now()
);

alter table public.user_outbound_ip
  add column if not exists plan_rotation_index integer not null default 0
    check (plan_rotation_index >= 0);

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
  using (auth.uid() = user_id);

-- Allow alternating SMTP rotation strategy
alter table public.campaigns
  drop constraint if exists campaigns_rotation_strategy_check;

alter table public.campaigns
  add constraint campaigns_rotation_strategy_check
  check (
    rotation_strategy in ('round_robin', 'random', 'threshold', 'alternating')
  );
