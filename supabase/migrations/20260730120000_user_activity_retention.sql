-- Admin user activity audit trail (2-day retention, purged by scripts/purge-user-activity.ts).

create table if not exists public.user_activity_batches (
  campaign_id uuid primary key references public.campaigns (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  stream_name text,
  subject text,
  recipient_count integer not null default 0,
  sent_count integer not null default 0,
  failed_count integer not null default 0,
  sent_at timestamptz not null,
  expires_at timestamptz not null
);

create index if not exists user_activity_batches_user_sent_idx
  on public.user_activity_batches (user_id, sent_at desc);

create index if not exists user_activity_batches_expires_idx
  on public.user_activity_batches (expires_at);

create table if not exists public.user_activity_snapshots (
  campaign_id uuid primary key references public.user_activity_batches (campaign_id) on delete cascade,
  subject text,
  body_html text,
  body_text text,
  sender_name text,
  attachments jsonb not null default '[]'::jsonb,
  html_attachment jsonb,
  sample_recipient jsonb not null default '{}'::jsonb
);

create table if not exists public.user_activity_recipients (
  id uuid primary key default gen_random_uuid(),
  campaign_id uuid not null references public.user_activity_batches (campaign_id) on delete cascade,
  recipient_email text not null,
  status text not null check (status in ('sent', 'failed', 'bounced')),
  sent_at timestamptz not null default now()
);

create index if not exists user_activity_recipients_campaign_idx
  on public.user_activity_recipients (campaign_id, sent_at desc);

alter table public.user_activity_batches enable row level security;
alter table public.user_activity_snapshots enable row level security;
alter table public.user_activity_recipients enable row level security;

drop policy if exists "user_activity_batches_admin_select" on public.user_activity_batches;
create policy "user_activity_batches_admin_select"
  on public.user_activity_batches for select
  using (public.is_admin(auth.uid()));

drop policy if exists "user_activity_snapshots_admin_select" on public.user_activity_snapshots;
create policy "user_activity_snapshots_admin_select"
  on public.user_activity_snapshots for select
  using (public.is_admin(auth.uid()));

drop policy if exists "user_activity_recipients_admin_select" on public.user_activity_recipients;
create policy "user_activity_recipients_admin_select"
  on public.user_activity_recipients for select
  using (public.is_admin(auth.uid()));
