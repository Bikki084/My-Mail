import { z } from "zod";
import {
  domainNameField,
  emailField,
  isoDateField,
  loginPasswordField,
  organizationNameField,
  uuidField,
  uuidListField,
} from "@/lib/validation/fields";

export const createClientUserSchema = z.object({
  organizationName: organizationNameField,
  email: emailField,
  password: loginPasswordField.min(6, "Password must be at least 6 characters."),
});

export const updateClientUserEmailSchema = z.object({
  userId: uuidField,
  email: emailField,
});

export const announcementCreateSchema = z.object({
  title: z
    .string({ error: "Title is required." })
    .min(1, "Title is required.")
    .max(160, "Title must be at most 160 characters.")
    .transform((s) => s.trim())
    .refine((s) => s.length > 0, "Title is required."),
  body: z
    .string({ error: "Message is required." })
    .min(1, "Message is required.")
    .max(4000, "Message must be at most 4000 characters.")
    .transform((s) => s.trim())
    .refine((s) => s.length > 0, "Message is required."),
});

export const announcementIdSchema = z.object({
  id: uuidField,
});

export const announcementReadIdsSchema = z.object({
  ids: uuidListField(100),
});

export const walletTopUpSchema = z.object({
  userId: uuidField,
  amount: z.coerce
    .number({ error: "Amount must be a number." })
    .int("Amount must be a whole number.")
    .min(1, "Amount must be a positive whole number.")
    .max(10_000_000, "Amount is unrealistically large."),
  note: z
    .string()
    .max(500, "Note must be at most 500 characters.")
    .transform((s) => s.trim())
    .transform((s) => (s.length > 0 ? s : undefined))
    .optional(),
});

export const usageReportQuerySchema = z.object({
  from: isoDateField.optional(),
  to: isoDateField.optional(),
});

export const deliverabilityDnsSchema = z.object({
  domain: domainNameField,
  dmarcReportEmail: emailField.optional(),
  smtpInclude: z.string().max(500, "SMTP include list is too long.").optional(),
});
