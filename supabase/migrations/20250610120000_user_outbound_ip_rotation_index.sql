-- Track which plan server slot (0-based) is active for outbound IP rotation.
alter table public.user_outbound_ip
  add column if not exists plan_rotation_index integer not null default 0
    check (plan_rotation_index >= 0);
