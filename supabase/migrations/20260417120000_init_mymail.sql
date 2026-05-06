-- MyMail SaaS — schema aligned with project proposal (PostgreSQL / Supabase)

-- Profiles (extends auth.users)
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

-- Credits (four independent types)
create table if not exists public.credits (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade unique,
  email_credits integer not null default 0 check (email_credits >= 0),
  server_credits integer not null default 0 check (server_credits >= 0),
  time_credits_hours integer not null default 0 check (time_credits_hours >= 0),
  campaign_credits integer not null default 0 check (campaign_credits >= 0),
  expires_at timestamptz,
  updated_at timestamptz not null default now()
);

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

-- SMTP servers per client
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

-- Campaigns
create table if not exists public.campaigns (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  stream_name text not null,
  subject text,
  body_html text,
  body_text text,
  sender_name text,
  encoding text not null default 'quoted-printable'
    check (encoding in ('none', 'base64', 'quoted-printable', '7bit', '8bit', 'binary')),
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

create index if not exists campaigns_user_idx on public.campaigns (user_id, created_at desc);

-- Per-recipient logs
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

-- Admin announcements
create table if not exists public.announcements (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  body text not null,
  created_by uuid references public.profiles (id),
  created_at timestamptz not null default now()
);

-- Login audit (simple table; proposal: login history)
create table if not exists public.login_events (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  event_type text not null check (event_type in ('login', 'logout')),
  ip_address text,
  user_agent text,
  created_at timestamptz not null default now()
);

create index if not exists login_events_user_idx on public.login_events (user_id, created_at desc);

-- New auth user → profile + credits row
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
  );
  insert into public.credits (user_id) values (new.id);
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- RLS
alter table public.profiles enable row level security;
alter table public.credits enable row level security;
alter table public.credit_transactions enable row level security;
alter table public.smtp_servers enable row level security;
alter table public.campaigns enable row level security;
alter table public.sending_logs enable row level security;
alter table public.announcements enable row level security;
alter table public.login_events enable row level security;

-- Policies: users read own profile; admin full access via service role in API
create policy "profiles_select_own_or_admin"
  on public.profiles for select
  using (
    auth.uid() = id
    or exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = 'admin')
  );

create policy "profiles_update_own"
  on public.profiles for update
  using (auth.uid() = id);

-- Credits: own row or admin
create policy "credits_select"
  on public.credits for select
  using (
    auth.uid() = user_id
    or exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = 'admin')
  );

create policy "credit_transactions_select"
  on public.credit_transactions for select
  using (
    auth.uid() = user_id
    or exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = 'admin')
  );

-- SMTP / campaigns / logs: own data or admin
create policy "smtp_servers_access"
  on public.smtp_servers for all
  using (
    auth.uid() = user_id
    or exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = 'admin')
  )
  with check (
    auth.uid() = user_id
    or exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = 'admin')
  );

create policy "campaigns_access"
  on public.campaigns for all
  using (
    auth.uid() = user_id
    or exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = 'admin')
  )
  with check (
    auth.uid() = user_id
    or exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = 'admin')
  );

create policy "sending_logs_access"
  on public.sending_logs for all
  using (
    auth.uid() = user_id
    or exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = 'admin')
  )
  with check (
    auth.uid() = user_id
    or exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = 'admin')
  );

create policy "announcements_read"
  on public.announcements for select
  using (true);

create policy "login_events_own"
  on public.login_events for all
  using (
    auth.uid() = user_id
    or exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = 'admin')
  )
  with check (
    auth.uid() = user_id
    or exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = 'admin')
  );

-- Note: INSERT for profiles/credits on signup uses trigger (security definer). Admin-created users
-- should use Supabase Admin API with service role, or insert into auth.users via dashboard.
