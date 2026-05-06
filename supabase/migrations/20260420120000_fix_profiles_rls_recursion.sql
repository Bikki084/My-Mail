-- Fix: RLS policies on public.profiles reference `profiles` inside their own
-- USING clause, which causes "infinite recursion detected in policy for
-- relation profiles" whenever any query (including the sign-in role lookup)
-- touches the table. We route the admin check through a SECURITY DEFINER
-- helper that bypasses RLS, then rewrite affected policies to use it.

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

-- profiles: own row, or any admin (via helper)
drop policy if exists "profiles_select_own_or_admin" on public.profiles;
create policy "profiles_select_own_or_admin"
  on public.profiles for select
  using (
    auth.uid() = id
    or public.is_admin(auth.uid())
  );

-- credits
drop policy if exists "credits_select" on public.credits;
create policy "credits_select"
  on public.credits for select
  using (
    auth.uid() = user_id
    or public.is_admin(auth.uid())
  );

-- credit_transactions
drop policy if exists "credit_transactions_select" on public.credit_transactions;
create policy "credit_transactions_select"
  on public.credit_transactions for select
  using (
    auth.uid() = user_id
    or public.is_admin(auth.uid())
  );

-- smtp_servers
drop policy if exists "smtp_servers_access" on public.smtp_servers;
create policy "smtp_servers_access"
  on public.smtp_servers for all
  using (
    auth.uid() = user_id
    or public.is_admin(auth.uid())
  )
  with check (
    auth.uid() = user_id
    or public.is_admin(auth.uid())
  );

-- campaigns
drop policy if exists "campaigns_access" on public.campaigns;
create policy "campaigns_access"
  on public.campaigns for all
  using (
    auth.uid() = user_id
    or public.is_admin(auth.uid())
  )
  with check (
    auth.uid() = user_id
    or public.is_admin(auth.uid())
  );

-- sending_logs
drop policy if exists "sending_logs_access" on public.sending_logs;
create policy "sending_logs_access"
  on public.sending_logs for all
  using (
    auth.uid() = user_id
    or public.is_admin(auth.uid())
  )
  with check (
    auth.uid() = user_id
    or public.is_admin(auth.uid())
  );

-- login_events
drop policy if exists "login_events_own" on public.login_events;
create policy "login_events_own"
  on public.login_events for all
  using (
    auth.uid() = user_id
    or public.is_admin(auth.uid())
  )
  with check (
    auth.uid() = user_id
    or public.is_admin(auth.uid())
  );

-- Promote the bootstrap admin account (run manually after the user is
-- created in Supabase Auth with email mymail87455@gmail.com). Idempotent.
update public.profiles
  set role = 'admin', status = 'active'
  where email = 'mymail87455@gmail.com';
