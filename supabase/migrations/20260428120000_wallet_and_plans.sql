-- MyMail SaaS — wallet balance + plan-based server allocation
--
-- This migration introduces a single "wallet" balance and a per-user active
-- plan model. The legacy four-credit-type columns on `public.credits`
-- (email_credits/server_credits/time_credits_hours/campaign_credits) and
-- `public.credit_transactions` are NOT removed — the migration is purely
-- additive so existing data and code paths continue to work.
--
-- New shape:
--   credits.wallet_balance    : single integer wallet, topped up by admin.
--   active_plans              : zero-or-one row per user holding the currently
--                               active plan + its expiry timestamp.
--   wallet_transactions       : audit log for top-ups and plan purchases.
--
-- Idempotent: safe to re-run.

-------------------------------------------------------------------------------
-- 1) Wallet balance on existing credits row
-------------------------------------------------------------------------------

alter table public.credits
  add column if not exists wallet_balance integer not null default 0;

-- The CHECK is only added the first time this migration runs against a table
-- that doesn't already have it, so wrap in a DO block to skip on re-run.
do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'credits_wallet_balance_check'
      and conrelid = 'public.credits'::regclass
  ) then
    alter table public.credits
      add constraint credits_wallet_balance_check
      check (wallet_balance >= 0);
  end if;
end$$;

-------------------------------------------------------------------------------
-- 2) Active plan per user (single row; replaced when user purchases another)
-------------------------------------------------------------------------------

create table if not exists public.active_plans (
  user_id uuid primary key references public.profiles (id) on delete cascade,
  plan_id text not null,
  -- NULL means "unlimited" (the 2000-credit plan).
  servers_allowed integer check (servers_allowed is null or servers_allowed > 0),
  started_at timestamptz not null default now(),
  expires_at timestamptz not null,
  updated_at timestamptz not null default now()
);

create index if not exists active_plans_expires_idx
  on public.active_plans (expires_at);

-------------------------------------------------------------------------------
-- 3) Wallet transactions audit log
-------------------------------------------------------------------------------

create table if not exists public.wallet_transactions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  admin_id uuid references public.profiles (id),
  -- 'topup'         : admin credited the wallet (positive amount)
  -- 'plan_purchase' : user activated a plan (negative amount = cost)
  kind text not null check (kind in ('topup', 'plan_purchase')),
  -- Signed integer; positive for top-ups, negative for purchases.
  amount integer not null,
  plan_id text,
  note text,
  created_at timestamptz not null default now()
);

create index if not exists wallet_transactions_user_idx
  on public.wallet_transactions (user_id, created_at desc);

-------------------------------------------------------------------------------
-- 4) RLS
-------------------------------------------------------------------------------

alter table public.active_plans enable row level security;
alter table public.wallet_transactions enable row level security;

-- active_plans: client reads own; admin reads all (writes go through service role).
drop policy if exists "active_plans_select" on public.active_plans;
create policy "active_plans_select"
  on public.active_plans for select
  using (
    auth.uid() = user_id
    or exists (
      select 1 from public.profiles p
      where p.id = auth.uid() and p.role = 'admin'
    )
  );

-- wallet_transactions: same rule as credit_transactions.
drop policy if exists "wallet_transactions_select" on public.wallet_transactions;
create policy "wallet_transactions_select"
  on public.wallet_transactions for select
  using (
    auth.uid() = user_id
    or exists (
      select 1 from public.profiles p
      where p.id = auth.uid() and p.role = 'admin'
    )
  );
