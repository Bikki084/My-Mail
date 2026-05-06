alter table public.campaigns
  drop constraint if exists campaigns_encoding_check;

alter table public.campaigns
  add constraint campaigns_encoding_check
  check (
    encoding in (
      'auto',
      'pdf_to_text',
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
