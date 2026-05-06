-- MyMail SaaS — surface background delivery failures to the UI.
--
-- Without this column, when /api/campaigns/[id]/send returns 200 (mode=started)
-- and the unawaited `runSendCampaign` then fails (e.g. SMTP auth error, missing
-- column on the campaigns table, decrypt error), the only signal the user gets
-- is `status='failed'` — they have no idea why. This column lets the worker /
-- API persist a human-readable reason that the progress monitor can then show
-- in the failure modal.

alter table public.campaigns
  add column if not exists last_error text;
