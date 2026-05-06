-- Announcements: per-user read tracking + admin write policies.
-- Enables the client-side bell/red-dot flow: a user sees a pop-up once per new
-- announcement and, after explicitly acknowledging it, the dot goes away.

create table if not exists public.announcement_reads (
  announcement_id uuid not null references public.announcements (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  read_at timestamptz not null default now(),
  primary key (announcement_id, user_id)
);

create index if not exists announcement_reads_user_idx
  on public.announcement_reads (user_id);

alter table public.announcement_reads enable row level security;

drop policy if exists "announcement_reads_own" on public.announcement_reads;
create policy "announcement_reads_own"
  on public.announcement_reads for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

-- Admins can publish / remove announcements directly (RLS currently only allows
-- the select side; INSERT/DELETE/UPDATE were effectively blocked).
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
