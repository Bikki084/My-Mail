-- Admin-only password reset tokens on public.profiles (single admin account).
-- `reset_token` stores the SHA-256 hex digest of the secret token from the email
-- link — the raw token is never persisted. `reset_token_expiry` is the instant
-- the link stops working (10-minute window set by the app).

alter table public.profiles
  add column if not exists reset_token text,
  add column if not exists reset_token_expiry timestamptz;

comment on column public.profiles.reset_token is
  'SHA-256 hex digest of the one-time admin password-reset token (never store raw token).';
comment on column public.profiles.reset_token_expiry is
  'Timestamptz when the admin reset token stops being valid.';
