-- Optional HTML template rendered to PDF/PNG per recipient at send time
alter table public.campaigns
  add column if not exists html_attachment jsonb;
