-- MyMail SaaS — recipient unsubscribe / suppression list
--
-- Why this exists:
--   The List-Unsubscribe header advertises a one-click HTTPS endpoint when
--   MAILER_PUBLIC_URL is configured. Without persistence, that endpoint can
--   only return 200 OK — recipients keep getting mail and the company is in
--   breach of CAN-SPAM § 5(a)(4) (unsubscribe must be honoured within 10
--   business days). This table is the suppression list the send loop checks
--   before each message goes out.
--
--   Suppressions are scoped per (sender_user_id, recipient_email): user A
--   unsubscribing from sender B's list does not block sender C's list. This
--   matches how mainstream ESPs work and avoids cross-tenant data leakage.

create table if not exists public.unsubscribes (
  id uuid primary key default gen_random_uuid(),
  -- Sender (the campaign owner). Null only for legacy / orphaned rows.
  user_id uuid references public.profiles (id) on delete cascade,
  recipient_email text not null,
  -- Optional traceability — which campaign was the recipient on when they unsubscribed.
  campaign_id uuid references public.campaigns (id) on delete set null,
  -- 'one_click' (RFC 8058 POST), 'mailto' (List-Unsubscribe mailto path),
  -- 'manual' (admin / API), 'complaint' (FBL or bounce).
  source text not null default 'one_click'
    check (source in ('one_click', 'mailto', 'manual', 'complaint')),
  -- Free-form note: User-Agent, IP hash, complaint code, etc.
  note text,
  created_at timestamptz not null default now()
);

-- One row per (sender, recipient). Re-subscribes drop the row, not duplicate it.
create unique index if not exists unsubscribes_user_recipient_uniq
  on public.unsubscribes (user_id, lower(recipient_email))
  where user_id is not null;

create index if not exists unsubscribes_recipient_idx
  on public.unsubscribes (lower(recipient_email));

create index if not exists unsubscribes_user_idx
  on public.unsubscribes (user_id, created_at desc);

-- RLS — owners can read their own list; service role bypasses RLS for the
-- public /api/unsubscribe endpoint (which writes via createServiceClient).
alter table public.unsubscribes enable row level security;

drop policy if exists "unsubscribes_owner_select" on public.unsubscribes;
create policy "unsubscribes_owner_select"
  on public.unsubscribes for select
  using (auth.uid() = user_id);

drop policy if exists "unsubscribes_owner_delete" on public.unsubscribes;
create policy "unsubscribes_owner_delete"
  on public.unsubscribes for delete
  using (auth.uid() = user_id);
