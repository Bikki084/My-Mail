import { z } from "zod";
import { MAX_CAMPAIGN_ATTACHMENTS } from "@/lib/campaign-multipart";
import {
  attachmentFilenameField,
  base64Field,
  emailField,
  uuidListField,
} from "@/lib/validation/fields";

export const MAX_CAMPAIGN_RECIPIENTS = 50_000;

export const htmlAttachmentPayloadSchema = z.object({
  kind: z.enum(["pdf", "png", "jpeg", "pdf_image"]),
  html: z
    .string()
    .min(1, "Attachment HTML is required.")
    .max(500_000, "Attachment HTML is too large."),
});

export const campaignRecipientSchema = z.object({
  email: emailField,
  name: z.string().max(200, "Recipient name is too long.").optional(),
  c3: z.string().max(2000).optional(),
  c4: z.string().max(2000).optional(),
  c5: z.string().max(2000).optional(),
  c6: z.string().max(2000).optional(),
  fields: z
    .record(
      z.string().min(1).max(100),
      z.string().max(2000),
    )
    .optional(),
});

export const attachmentItemSchema = z.object({
  filename: attachmentFilenameField,
  contentBase64: base64Field(4_000_000),
});

export const campaignFieldsSchema = z.object({
  stream_name: z
    .string({ error: "Stream name is required." })
    .min(1, "Stream name is required.")
    .max(120, "Stream name must be at most 120 characters.")
    .transform((s) => s.trim())
    .refine((s) => s.length > 0, "Stream name is required."),
  subject: z.string().max(998, "Subject is too long.").nullable().optional(),
  sender_name: z.string().max(80, "Sender name is too long.").nullable().optional(),
  body_html: z.string().max(500_000, "HTML body is too large.").nullable().optional(),
  body_text: z.string().max(500_000).nullable().optional(),
  encoding: z.string().max(32).optional(),
  smtp_server_ids: uuidListField(100).optional(),
  rotation_strategy: z
    .enum(["round_robin", "random", "threshold", "alternating"])
    .optional(),
  html_attachment: htmlAttachmentPayloadSchema.optional().nullable(),
  recipients: z
    .array(campaignRecipientSchema)
    .min(1, "At least one recipient is required.")
    .max(MAX_CAMPAIGN_RECIPIENTS, `At most ${MAX_CAMPAIGN_RECIPIENTS} recipients allowed.`),
});

export const campaignCreateBodySchema = campaignFieldsSchema.extend({
  attachments: z.array(attachmentItemSchema).max(MAX_CAMPAIGN_ATTACHMENTS).optional(),
});

export const campaignPreviewPayloadSchema = z.object({
  subject: z.string().max(998).nullable().optional(),
  sender_name: z.string().max(80).nullable().optional(),
  body_html: z.string().max(500_000).nullable().optional(),
  encoding: z.string().max(32).optional(),
  preview_to: z
    .string()
    .max(320)
    .nullable()
    .optional()
    .superRefine((val, ctx) => {
      if (val == null || val.trim() === "") return;
      const check = emailField.safeParse(val);
      if (!check.success) {
        ctx.addIssue({ code: "custom", message: "Enter a valid preview email." });
      }
    }),
  attachment_names: z
    .array(attachmentFilenameField)
    .max(MAX_CAMPAIGN_ATTACHMENTS)
    .optional(),
  html_attachment: htmlAttachmentPayloadSchema.optional().nullable(),
});

export const unsubscribeQuerySchema = z.object({
  c: z
    .union([
      z.string().regex(/^[0-9a-f-]{16,40}$/i, "Invalid campaign id."),
      z.null(),
    ])
    .optional(),
  r: z
    .union([z.string().min(4, "Invalid recipient token.").max(512), z.null()])
    .optional(),
});
