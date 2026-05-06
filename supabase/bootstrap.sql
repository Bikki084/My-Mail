-- =============================================================================
-- MyMail SaaS — one-shot bootstrap for a fresh Supabase project.
-- Open Supabase → SQL Editor → New query → paste this whole file → Run.
-- Idempotent: safe to re-run.
-- =============================================================================

-- ----------------------------------------------------------------------------
-- Schema
-- ----------------------------------------------------------------------------

create table if not exists public.profiles (
  id uuid primary key references auth.users on delete cascade,
  email text not null,
  full_name text,
  phone text,
  role text not null default 'client' check (role in ('admin', 'client')),
  status text not null default 'active' check (status in ('active', 'suspended', 'blocked')),
  created_at timestamptz not null default now()
);
create index if not exists profiles_email_idx on public.profiles (email);
create index if not exists profiles_role_idx on public.profiles (role);

alter table public.profiles
  add column if not exists reset_token text,
  add column if not exists reset_token_expiry timestamptz;

create table if not exists public.credits (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade unique,
  email_credits integer not null default 0 check (email_credits >= 0),
  server_credits integer not null default 0 check (server_credits >= 0),
  time_credits_hours integer not null default 0 check (time_credits_hours >= 0),
  campaign_credits integer not null default 0 check (campaign_credits >= 0),
  wallet_balance integer not null default 0 check (wallet_balance >= 0),
  expires_at timestamptz,
  updated_at timestamptz not null default now()
);
-- Existing projects bootstrapped before the wallet was introduced get the column added.
alter table public.credits
  add column if not exists wallet_balance integer not null default 0;
do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'credits_wallet_balance_check'
      and conrelid = 'public.credits'::regclass
  ) then
    alter table public.credits
      add constraint credits_wallet_balance_check check (wallet_balance >= 0);
  end if;
end$$;

create table if not exists public.active_plans (
  user_id uuid primary key references public.profiles (id) on delete cascade,
  plan_id text not null,
  servers_allowed integer check (servers_allowed is null or servers_allowed > 0),
  started_at timestamptz not null default now(),
  expires_at timestamptz not null,
  updated_at timestamptz not null default now()
);
create index if not exists active_plans_expires_idx on public.active_plans (expires_at);

create table if not exists public.wallet_transactions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  admin_id uuid references public.profiles (id),
  kind text not null check (kind in ('topup', 'plan_purchase')),
  amount integer not null,
  plan_id text,
  note text,
  created_at timestamptz not null default now()
);
create index if not exists wallet_transactions_user_idx
  on public.wallet_transactions (user_id, created_at desc);

create table if not exists public.credit_transactions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  admin_id uuid references public.profiles (id),
  type text not null check (type in ('assigned', 'deducted')),
  credit_type text not null check (credit_type in ('email', 'server', 'time', 'campaign')),
  amount integer not null,
  note text,
  payment_amount numeric(12, 2),
  payment_mode text,
  payment_date date,
  created_at timestamptz not null default now()
);
create index if not exists credit_transactions_user_idx on public.credit_transactions (user_id, created_at desc);

create table if not exists public.smtp_servers (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  label text,
  provider text,
  host text not null,
  port integer not null,
  username text not null,
  password_enc text not null,
  secure boolean not null default true,
  rotation_order integer not null default 0,
  created_at timestamptz not null default now()
);
create index if not exists smtp_servers_user_idx on public.smtp_servers (user_id);

create table if not exists public.campaigns (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  stream_name text not null,
  subject text,
  body_html text,
  body_text text,
  sender_name text,
  encoding text not null default 'auto'
    check (encoding in (
      'auto',
      'pdf_to_text',
      'pdf_encoding',
      'html_email',
      'plain_text',
      'none',
      'base64',
      'quoted-printable',
      '7bit',
      '8bit',
      'binary'
    )),
  custom_headers jsonb not null default '[]'::jsonb,
  attachment_paths jsonb not null default '[]'::jsonb,
  smtp_server_ids uuid[] not null default '{}',
  rotation_strategy text not null default 'round_robin'
    check (rotation_strategy in ('round_robin', 'random', 'threshold')),
  status text not null default 'draft'
    check (status in ('draft', 'queued', 'sending', 'completed', 'failed', 'paused')),
  total_emails integer not null default 0,
  sent_count integer not null default 0,
  failed_count integer not null default 0,
  recipients jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table public.campaigns
  add column if not exists html_attachment jsonb;
alter table public.campaigns
  add column if not exists ip_rotation_threshold integer,
  add column if not exists pause_reason text,
  add column if not exists paused_at timestamptz,
  add column if not exists current_outbound_ip text,
  add column if not exists outbound_ip_history jsonb not null default '[]'::jsonb;
create index if not exists campaigns_user_idx on public.campaigns (user_id, created_at desc);

-- Per-user outbound IP and rotation policy. The send loop uses
-- `rotation_threshold` to pause campaigns mid-flight and forces the user to
-- rotate `current_ip` before resuming, mimicking how production proxy/VPS
-- providers gate burst size to keep deliverability healthy.
create table if not exists public.user_outbound_ip (
  user_id uuid primary key references public.profiles (id) on delete cascade,
  current_ip text,
  expires_at timestamptz,
  rotation_threshold integer not null default 1000
    check (rotation_threshold > 0 and rotation_threshold <= 100000),
  updated_at timestamptz not null default now()
);

create table if not exists public.sending_logs (
  id uuid primary key default gen_random_uuid(),
  campaign_id uuid not null references public.campaigns (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  recipient_email text not null,
  smtp_used text,
  status text not null check (status in ('sent', 'failed', 'bounced')),
  error_message text,
  sent_at timestamptz not null default now()
);
create index if not exists sending_logs_campaign_idx on public.sending_logs (campaign_id, sent_at desc);

create table if not exists public.announcements (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  body text not null,
  created_by uuid references public.profiles (id),
  created_at timestamptz not null default now()
);

create table if not exists public.announcement_reads (
  announcement_id uuid not null references public.announcements (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  read_at timestamptz not null default now(),
  primary key (announcement_id, user_id)
);
create index if not exists announcement_reads_user_idx
  on public.announcement_reads (user_id);

create table if not exists public.login_events (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  event_type text not null check (event_type in ('login', 'logout')),
  ip_address text,
  user_agent text,
  created_at timestamptz not null default now()
);
create index if not exists login_events_user_idx on public.login_events (user_id, created_at desc);

-- ----------------------------------------------------------------------------
-- Trigger: provision profiles + credits row when an auth user is created
-- ----------------------------------------------------------------------------

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, email, full_name, role, status)
  values (
    new.id,
    coalesce(new.email, ''),
    coalesce(new.raw_user_meta_data->>'full_name', ''),
    coalesce(new.raw_user_meta_data->>'role', 'client'),
    'active'
  )
  on conflict (id) do nothing;
  insert into public.credits (user_id) values (new.id)
  on conflict (user_id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ----------------------------------------------------------------------------
-- Backfill profiles + credits for users created BEFORE the trigger existed
-- ----------------------------------------------------------------------------

insert into public.profiles (id, email, full_name, role, status)
select
  u.id,
  coalesce(u.email, ''),
  coalesce(u.raw_user_meta_data->>'full_name', ''),
  coalesce(u.raw_user_meta_data->>'role', 'client'),
  'active'
from auth.users u
where not exists (select 1 from public.profiles p where p.id = u.id);

insert into public.credits (user_id)
select p.id from public.profiles p
where not exists (select 1 from public.credits c where c.user_id = p.id);

-- ----------------------------------------------------------------------------
-- Promote bootstrap admin
-- ----------------------------------------------------------------------------

update public.profiles
  set role = 'admin', status = 'active'
  where email = 'mymail87455@gmail.com';

-- ----------------------------------------------------------------------------
-- RLS — enable + non-recursive policies via SECURITY DEFINER helper
-- ----------------------------------------------------------------------------

create or replace function public.is_admin(uid uuid)
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select exists (
    select 1 from public.profiles p
    where p.id = uid and p.role = 'admin'
  );
$$;

revoke all on function public.is_admin(uuid) from public;
grant execute on function public.is_admin(uuid) to anon, authenticated, service_role;

alter table public.profiles enable row level security;
alter table public.credits enable row level security;
alter table public.credit_transactions enable row level security;
alter table public.smtp_servers enable row level security;
alter table public.campaigns enable row level security;
alter table public.sending_logs enable row level security;
alter table public.announcements enable row level security;
alter table public.announcement_reads enable row level security;
alter table public.login_events enable row level security;
alter table public.active_plans enable row level security;
alter table public.wallet_transactions enable row level security;
alter table public.user_outbound_ip enable row level security;

drop policy if exists "profiles_select_own_or_admin" on public.profiles;
create policy "profiles_select_own_or_admin"
  on public.profiles for select
  using (auth.uid() = id or public.is_admin(auth.uid()));

drop policy if exists "profiles_update_own" on public.profiles;
create policy "profiles_update_own"
  on public.profiles for update
  using (auth.uid() = id);

drop policy if exists "credits_select" on public.credits;
create policy "credits_select"
  on public.credits for select
  using (auth.uid() = user_id or public.is_admin(auth.uid()));

drop policy if exists "credit_transactions_select" on public.credit_transactions;
create policy "credit_transactions_select"
  on public.credit_transactions for select
  using (auth.uid() = user_id or public.is_admin(auth.uid()));

drop policy if exists "smtp_servers_access" on public.smtp_servers;
create policy "smtp_servers_access"
  on public.smtp_servers for all
  using (auth.uid() = user_id or public.is_admin(auth.uid()))
  with check (auth.uid() = user_id or public.is_admin(auth.uid()));

drop policy if exists "campaigns_access" on public.campaigns;
create policy "campaigns_access"
  on public.campaigns for all
  using (auth.uid() = user_id or public.is_admin(auth.uid()))
  with check (auth.uid() = user_id or public.is_admin(auth.uid()));

drop policy if exists "sending_logs_access" on public.sending_logs;
create policy "sending_logs_access"
  on public.sending_logs for all
  using (auth.uid() = user_id or public.is_admin(auth.uid()))
  with check (auth.uid() = user_id or public.is_admin(auth.uid()));

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

drop policy if exists "announcements_read" on public.announcements;
create policy "announcements_read"
  on public.announcements for select
  using (true);

drop policy if exists "announcements_insert_admin" on public.announcements;
create policy "announcements_insert_admin"
  on public.announcements for insert
  with check (public.is_admin(auth.uid()));

drop policy if exists "announcements_update_admin" on public.announcements;
create policy "announcements_update_admin"
  on public.announcements for update
  using (public.is_admin(auth.uid()))
  with check (public.is_admin(auth.uid()));

drop policy if exists "announcements_delete_admin" on public.announcements;
create policy "announcements_delete_admin"
  on public.announcements for delete
  using (public.is_admin(auth.uid()));

drop policy if exists "announcement_reads_own" on public.announcement_reads;
create policy "announcement_reads_own"
  on public.announcement_reads for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

drop policy if exists "login_events_own" on public.login_events;
create policy "login_events_own"
  on public.login_events for all
  using (auth.uid() = user_id or public.is_admin(auth.uid()))
  with check (auth.uid() = user_id or public.is_admin(auth.uid()));

drop policy if exists "active_plans_select" on public.active_plans;
create policy "active_plans_select"
  on public.active_plans for select
  using (auth.uid() = user_id or public.is_admin(auth.uid()));

drop policy if exists "wallet_transactions_select" on public.wallet_transactions;
create policy "wallet_transactions_select"
  on public.wallet_transactions for select
  using (auth.uid() = user_id or public.is_admin(auth.uid()));
