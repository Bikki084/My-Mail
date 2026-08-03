-- Recipient bounce prevention: expanded suppression sources, MX/validation cache, webhook audit.

-- Extend unsubscribes.source for bounces, blocks, spam, and pre-send validation blocks.
alter table public.unsubscribes drop constraint if exists unsubscribes_source_check;
alter table public.unsubscribes add constraint unsubscribes_source_check
  check (source in (
    'one_click', 'mailto', 'manual', 'complaint',
    'hard_bounce', 'soft_bounce', 'blocked', 'spam_report', 'validation'
  ));

comment on column public.unsubscribes.source is
  'Suppression reason: unsubscribe paths, FBL/complaint, SMTP bounces/blocks, spam reports, or pre-send validation.';

-- Domain-level MX cache (shared across tenants — MX is a property of the domain).
create table if not exists public.domain_mx_cache (
  domain text primary key,
  has_mx boolean not null,
  checked_at timestamptz not null default now(),
  expires_at timestamptz not null
);

create index if not exists domain_mx_cache_expires_idx
  on public.domain_mx_cache (expires_at);

-- Optional audit trail for inbound provider webhooks (service role writes).
create table if not exists public.email_webhook_events (
  id uuid primary key default gen_random_uuid(),
  provider text not null,
  event_type text not null,
  recipient_email text not null,
  user_id uuid references public.profiles (id) on delete set null,
  campaign_id uuid references public.campaigns (id) on delete set null,
  raw jsonb,
  created_at timestamptz not null default now()
);

create index if not exists email_webhook_events_recipient_idx
  on public.email_webhook_events (lower(recipient_email), created_at desc);

create index if not exists email_webhook_events_user_idx
  on public.email_webhook_events (user_id, created_at desc);

alter table public.domain_mx_cache enable row level security;
alter table public.email_webhook_events enable row level security;

-- MX cache is shared DNS infrastructure data — any authenticated user may read/write.
drop policy if exists "domain_mx_cache_authenticated_all" on public.domain_mx_cache;
create policy "domain_mx_cache_authenticated_all"
  on public.domain_mx_cache for all
  to authenticated
  using (true)
  with check (true);

-- Webhook audit: service role only (no client policies).
