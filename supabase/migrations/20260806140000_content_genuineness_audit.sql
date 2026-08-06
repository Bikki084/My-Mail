-- Pre-send genuineness review audit (pass/fail per message version).

create table if not exists public.content_genuineness_audit (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  campaign_id uuid references public.campaigns (id) on delete set null,
  content_fingerprint text not null,
  passed boolean not null default false,
  failed_categories text[] not null default '{}',
  ai_suggested boolean not null default false,
  ai_accepted boolean not null default false,
  metadata jsonb,
  created_at timestamptz not null default now()
);

create index if not exists content_genuineness_audit_user_fp_idx
  on public.content_genuineness_audit (user_id, content_fingerprint, created_at desc);

create index if not exists content_genuineness_audit_user_idx
  on public.content_genuineness_audit (user_id, created_at desc);

alter table public.content_genuineness_audit enable row level security;

drop policy if exists "content_genuineness_admin_select" on public.content_genuineness_audit;
create policy "content_genuineness_admin_select"
  on public.content_genuineness_audit for select
  to authenticated
  using (public.is_admin(auth.uid()));

comment on table public.content_genuineness_audit is
  'Audit of pre-send genuineness gate results (pass/fail, categories, AI assist).';
