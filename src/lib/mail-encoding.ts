/**
 * User-facing encoding options and resolution for campaign email MIME parts.
 * Attachments are always sent as binary/base64-safe via Nodemailer; this module
 * drives body Content-Transfer-Encoding and the persisted `campaigns.encoding` value.
 */

export const MAIL_ENCODING_UI = ["auto", "html_email", "plain_text"] as const;

export type MailEncodingUi = (typeof MAIL_ENCODING_UI)[number];

export const MAIL_ENCODING_LABELS: Record<MailEncodingUi, string> = {
  auto: "Auto (Recommended)",
  html_email: "HTML Email",
  plain_text: "Plain Text",
};

/** API + DB accept these UI keys plus legacy MIME-style values. */
export const ALL_CAMPAIGN_ENCODING = [
  ...MAIL_ENCODING_UI,
  "pdf_to_text",
  "pdf_encoding",
  "none",
  "base64",
  "quoted-printable",
  "7bit",
  "8bit",
  "binary",
] as const;

export type StoredCampaignEncoding = (typeof ALL_CAMPAIGN_ENCODING)[number];

export function isPdfFilename(name: string): boolean {
  return name.toLowerCase().endsWith(".pdf");
}

export function hasPdfAttachment(filenames: string[]): boolean {
  return filenames.some(isPdfFilename);
}

/** Map persisted / legacy values to current UI mode for dropdowns and general UX. */
export function normalizeStoredEncoding(raw: string | null | undefined): MailEncodingUi {
  const s = (raw ?? "auto").trim();
  if (s === "pdf_to_text") return "auto";
  if (s === "auto" || s === "html_email" || s === "plain_text") {
    return s;
  }
  switch (s) {
    case "quoted-printable":
      return "html_email";
    case "7bit":
      return "plain_text";
    case "pdf_encoding":
    case "base64":
    case "none":
    case "8bit":
    case "binary":
    default:
      return "auto";
  }
}

export type ResolveMailEncodingResult = {
  /** Persisted on `campaigns.encoding` — must satisfy DB check constraint. */
  dbEncoding: "quoted-printable" | "7bit" | "base64";
  textContentTransferEncoding: "quoted-printable" | "7bit" | "base64";
  htmlContentTransferEncoding: "quoted-printable" | "7bit" | "base64";
};

/**
 * Maps UI / legacy option + content shape + attachments to MIME transfer encodings.
 * When any attachment exists, attachment parts are always base64 (Nodemailer default);
 * `dbEncoding` is forced to `base64` per product rules so sends never claim "7bit only" for campaigns with files.
 */
export function resolveMailEncoding(
  option: string | null | undefined,
  emailContent: { isHtml: boolean },
  attachmentCount: number,
): ResolveMailEncodingResult {
  const raw = (option ?? "auto").trim();
  const ui = normalizeStoredEncoding(option);

  if (attachmentCount > 0) {
    return {
      dbEncoding: "base64",
      textContentTransferEncoding: emailContent.isHtml ? "quoted-printable" : "7bit",
      htmlContentTransferEncoding: emailContent.isHtml ? "quoted-printable" : "7bit",
    };
  }

  if (raw === "pdf_encoding" || raw === "base64") {
    return {
      dbEncoding: "base64",
      textContentTransferEncoding: "7bit",
      htmlContentTransferEncoding: "base64",
    };
  }
  if (ui === "html_email") {
    return {
      dbEncoding: "quoted-printable",
      textContentTransferEncoding: "quoted-printable",
      htmlContentTransferEncoding: "quoted-printable",
    };
  }
  if (ui === "plain_text") {
    return {
      dbEncoding: "7bit",
      textContentTransferEncoding: "7bit",
      htmlContentTransferEncoding: "7bit",
    };
  }

  // auto
  if (emailContent.isHtml) {
    return {
      dbEncoding: "quoted-printable",
      textContentTransferEncoding: "quoted-printable",
      htmlContentTransferEncoding: "quoted-printable",
    };
  }
  return {
    dbEncoding: "7bit",
    textContentTransferEncoding: "7bit",
    htmlContentTransferEncoding: "7bit",
  };
}

/** Coerce client payload to a valid UI or legacy token before Zod / DB. */
export function coerceEncodingInput(raw: string | undefined | null): string {
  const s = (raw ?? "auto").trim();
  if (s === "pdf_to_text") return "auto";
  if (ALL_CAMPAIGN_ENCODING.includes(s as StoredCampaignEncoding)) return s;
  return "auto";
}
