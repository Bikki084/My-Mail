-- Durable content verification results keyed by user + content hash (survives tab switch / reload).

create table if not exists public.content_verification_results (
  user_id uuid not null references public.profiles (id) on delete cascade,
  content_fingerprint text not null,
  passed boolean not null default false,
  summary text not null default '',
  phishing_verdict jsonb,
  feedback jsonb,
  verified_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (user_id, content_fingerprint)
);

create index if not exists content_verification_results_user_updated_idx
  on public.content_verification_results (user_id, updated_at desc);

alter table public.content_verification_results enable row level security;

drop policy if exists "content_verification_results_owner_select" on public.content_verification_results;
create policy "content_verification_results_owner_select"
  on public.content_verification_results for select
  to authenticated
  using (auth.uid() = user_id);

drop policy if exists "content_verification_results_admin_select" on public.content_verification_results;
create policy "content_verification_results_admin_select"
  on public.content_verification_results for select
  to authenticated
  using (public.is_admin(auth.uid()));

comment on table public.content_verification_results is
  'Latest pass/fail verification per user and content fingerprint; API upserts on each review.';
