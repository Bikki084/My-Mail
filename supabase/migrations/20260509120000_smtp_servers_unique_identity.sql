-- Deduplicate existing SMTP rows (keep oldest per user + host + port + username).
with ranked as (
  select
    id,
    row_number() over (
      partition by
        user_id,
        lower(trim(host)),
        port,
        lower(trim(username))
      order by created_at asc, id asc
    ) as rn
  from public.smtp_servers
)
delete from public.smtp_servers s
using ranked r
where s.id = r.id
  and r.rn > 1;

-- One SMTP identity per user (host + port + username).
create unique index if not exists smtp_servers_user_identity_unique
  on public.smtp_servers (
    user_id,
    host,
    port,
    (lower(trim(username)))
  );
