-- Allow user-facing encoding labels on campaigns.encoding (auto, pdf_encoding, …)
-- alongside legacy MIME-style values.

alter table public.campaigns
  drop constraint if exists campaigns_encoding_check;

alter table public.campaigns
  add constraint campaigns_encoding_check
  check (
    encoding in (
      'auto',
      'pdf_encoding',
      'html_email',
      'plain_text',
      'none',
      'base64',
      'quoted-printable',
      '7bit',
      '8bit',
      'binary'
    )
  );
