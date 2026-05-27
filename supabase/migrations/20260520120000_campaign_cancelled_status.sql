-- Allow campaigns to be stopped when the user cancels their active plan.

do $$
declare
  cname text;
begin
  select conname into cname
  from pg_constraint
  where conrelid = 'public.campaigns'::regclass
    and contype = 'c'
    and pg_get_constraintdef(oid) ilike '%status%';

  if cname is not null then
    execute format('alter table public.campaigns drop constraint %I', cname);
  end if;
end$$;

alter table public.campaigns
  add constraint campaigns_status_check
  check (
    status in (
      'draft',
      'queued',
      'sending',
      'completed',
      'failed',
      'paused',
      'cancelled'
    )
  );
