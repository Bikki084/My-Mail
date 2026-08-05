import { z } from "zod";
import { htmlToPlainText } from "@/lib/html-email";

/** True when HTML contains readable text (not empty tags / whitespace only). */
export function bodyHtmlHasVisibleContent(html: string): boolean {
  return htmlToPlainText(html ?? "").trim().length > 0;
}

function trimmedRequiredField(label: string, max: number) {
  return z
    .string({ error: `${label} is required.` })
    .max(max, `${label} is too long.`)
    .transform((s) => (s ?? "").trim())
    .refine((s) => s.length > 0, `${label} is required.`);
}

export const campaignSenderNameField = trimmedRequiredField("Sender name", 80);
export const campaignSubjectField = trimmedRequiredField("Subject", 998);

export const campaignBodyHtmlField = z
  .string({ error: "Email body is required." })
  .max(500_000, "HTML body is too large.")
  .transform((s) => (s ?? "").trim())
  .refine((s) => s.length > 0, "Email body is required.")
  .refine(
    bodyHtmlHasVisibleContent,
    "Email body must contain readable text (not empty HTML).",
  );

export const campaignComposeRequiredSchema = z.object({
  sender_name: campaignSenderNameField,
  subject: campaignSubjectField,
  body_html: campaignBodyHtmlField,
});

export function validateCampaignComposeRequired(input: {
  senderName: string;
  subject: string;
  bodyHtml: string;
}): { ok: true } | { ok: false; message: string } {
  const parsed = campaignComposeRequiredSchema.safeParse({
    sender_name: input.senderName,
    subject: input.subject,
    body_html: input.bodyHtml,
  });
  if (parsed.success) return { ok: true };
  const first = parsed.error.issues[0];
  return { ok: false, message: first?.message ?? "Invalid campaign content." };
}
