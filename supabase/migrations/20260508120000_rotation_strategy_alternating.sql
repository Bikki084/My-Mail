-- Allow legacy per-recipient SMTP alternation (i % k) when rotation_strategy = 'alternating'.
-- Default remains 'round_robin' (even block split in campaign-delivery).

alter table public.campaigns
  drop constraint if exists campaigns_rotation_strategy_check;

alter table public.campaigns
  add constraint campaigns_rotation_strategy_check
  check (
    rotation_strategy in ('round_robin', 'random', 'threshold', 'alternating')
  );
