-- Trust tiers, anti-spam audit logs, and client sending limits.

alter table public.profiles
  add column if not exists trust_tier text not null default 'new'
    check (trust_tier in ('new', 'warming', 'established', 'restricted'));

alter table public.profiles
  add column if not exists trust_daily_send_limit integer not null default 30
    check (trust_daily_send_limit >= 0);

alter table public.profiles
  add column if not exists trust_tier_updated_at timestamptz not null default now();

comment on column public.profiles.trust_tier is
  'Progressive sending trust: new → warming → established; restricted when metrics fail.';
comment on column public.profiles.trust_daily_send_limit is
  'Max emails this client may send per UTC day at send-time (before ESP queue).';

create index if not exists profiles_trust_tier_idx on public.profiles (trust_tier);

-- Tier change audit (upgrades and downgrades).
create table if not exists public.client_trust_tier_history (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  from_tier text,
  to_tier text not null,
  reason text not null,
  metrics jsonb,
  created_at timestamptz not null default now()
);

create index if not exists client_trust_tier_history_user_idx
  on public.client_trust_tier_history (user_id, created_at desc);

-- Content-quality rejections (separate from suppression list).
create table if not exists public.content_rejection_audit (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  campaign_id uuid references public.campaigns (id) on delete set null,
  reason_code text not null,
  message text not null,
  metadata jsonb,
  created_at timestamptz not null default now()
);

create index if not exists content_rejection_audit_user_idx
  on public.content_rejection_audit (user_id, created_at desc);

-- Blocked attachment attempts (compliance / abuse signal).
create table if not exists public.attachment_block_audit (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  campaign_id uuid references public.campaigns (id) on delete set null,
  filename text not null,
  reason_code text not null,
  detected_type text,
  declared_extension text,
  created_at timestamptz not null default now()
);

create index if not exists attachment_block_audit_user_idx
  on public.attachment_block_audit (user_id, created_at desc);

-- Spam-risk rescoring attempts (detect score-gaming).
create table if not exists public.content_rescore_audit (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  content_fingerprint text not null,
  risk_level text not null,
  blocked boolean not null default false,
  created_at timestamptz not null default now()
);

create index if not exists content_rescore_audit_user_fp_idx
  on public.content_rescore_audit (user_id, content_fingerprint, created_at desc);

alter table public.client_trust_tier_history enable row level security;
alter table public.content_rejection_audit enable row level security;
alter table public.attachment_block_audit enable row level security;
alter table public.content_rescore_audit enable row level security;

-- Audit tables: service role writes; admins read via helper.
drop policy if exists "trust_tier_history_admin_select" on public.client_trust_tier_history;
create policy "trust_tier_history_admin_select"
  on public.client_trust_tier_history for select
  to authenticated
  using (public.is_admin(auth.uid()));

drop policy if exists "content_rejection_admin_select" on public.content_rejection_audit;
create policy "content_rejection_admin_select"
  on public.content_rejection_audit for select
  to authenticated
  using (public.is_admin(auth.uid()));

drop policy if exists "attachment_block_admin_select" on public.attachment_block_audit;
create policy "attachment_block_admin_select"
  on public.attachment_block_audit for select
  to authenticated
  using (public.is_admin(auth.uid()));

drop policy if exists "content_rescore_admin_select" on public.content_rescore_audit;
create policy "content_rescore_admin_select"
  on public.content_rescore_audit for select
  to authenticated
  using (public.is_admin(auth.uid()));

-- Clients may read their own trust tier columns on profiles (existing select policy covers it).
