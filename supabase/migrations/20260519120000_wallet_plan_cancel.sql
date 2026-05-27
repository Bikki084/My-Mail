-- Allow audit rows when a user cancels an active plan early (wallet balance unchanged).

do $$
declare
  cname text;
begin
  select conname into cname
  from pg_constraint
  where conrelid = 'public.wallet_transactions'::regclass
    and contype = 'c'
    and pg_get_constraintdef(oid) like '%kind%';

  if cname is not null then
    execute format('alter table public.wallet_transactions drop constraint %I', cname);
  end if;
end$$;

alter table public.wallet_transactions
  add constraint wallet_transactions_kind_check
  check (kind in ('topup', 'plan_purchase', 'plan_cancel'));
