import { z } from "zod";
import {
  AUTH_EMAIL_MAX_LENGTH,
  AUTH_NEW_PASSWORD_MAX_LENGTH,
  AUTH_PASSWORD_MAX_LENGTH,
} from "@/lib/auth/field-limits";

const HOST_RE = /^[a-z0-9.-]+\.[a-z]{2,}$/i;
const IP_V4 =
  /^(?:(?:25[0-5]|2[0-4]\d|[01]?\d{1,2})\.){3}(?:25[0-5]|2[0-4]\d|[01]?\d{1,2})$/;
const DOMAIN_RE =
  /^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$/;
const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const BASE64_RE = /^[A-Za-z0-9+/=]+$/;

export const emailField = z
  .string({ error: "Email is required." })
  .min(1, "Email is required.")
  .max(AUTH_EMAIL_MAX_LENGTH, `Email must be at most ${AUTH_EMAIL_MAX_LENGTH} characters.`)
  .email("Enter a valid email address.")
  .transform((s) => s.trim().toLowerCase());

export const loginPasswordField = z
  .string({ error: "Password is required." })
  .min(1, "Password is required.")
  .max(AUTH_PASSWORD_MAX_LENGTH, `Password must be at most ${AUTH_PASSWORD_MAX_LENGTH} characters.`);

export const newPasswordField = z
  .string({ error: "Password is required." })
  .min(6, "Password must be at least 6 characters.")
  .max(
    AUTH_NEW_PASSWORD_MAX_LENGTH,
    `Password must be at most ${AUTH_NEW_PASSWORD_MAX_LENGTH} characters.`,
  );

export const uuidField = z.string().uuid("Invalid id format.");

export const uuidListField = (max: number) =>
  z.array(uuidField).max(max, `At most ${max} ids allowed.`);

export const organizationNameField = z
  .string({ error: "Organization name is required." })
  .min(1, "Organization name is required.")
  .max(80, "Organization name must be at most 80 characters.")
  .transform((s) => s.trim())
  .refine((s) => s.length > 0, "Organization name is required.")
  .refine(
    (s) => /^[a-zA-Z0-9 ]+$/.test(s),
    "Organization name must not contain special characters.",
  );

export const smtpHostField = z
  .string({ error: "Host is required." })
  .min(1, "Host is required.")
  .max(253, "Host is too long.")
  .transform((s) => s.trim().toLowerCase())
  .refine(
    (host) => host === "localhost" || IP_V4.test(host) || HOST_RE.test(host),
    "Host looks invalid (use e.g. smtp.gmail.com, localhost, or 127.0.0.1).",
  );

export const smtpPortField = z.coerce
  .number({ error: "Port must be a number." })
  .int("Port must be a whole number.")
  .min(1, "Port must be between 1 and 65535.")
  .max(65535, "Port must be between 1 and 65535.");

export const smtpUsernameField = z
  .string({ error: "Username is required." })
  .min(1, "Username is required.")
  .max(320, "Username is too long.")
  .transform((s) => s.trim());

export const smtpPasswordField = z
  .string({ error: "Password is required." })
  .min(1, "Password is required.")
  .max(512, "Password is unexpectedly long.")
  .refine((s) => !/\s/.test(s), {
    message: "Password must not contain spaces (remove spaces from Gmail App Passwords).",
  });

export const smtpLabelField = z
  .string()
  .max(80, "Label must be at most 80 characters.")
  .transform((s) => s.trim())
  .transform((s) => (s.length > 0 ? s : null));

export const domainNameField = z
  .string({ error: "Domain is required." })
  .min(1, "Domain is required.")
  .max(253, "Domain is too long.")
  .transform((s) => s.trim().toLowerCase())
  .refine((d) => !d.includes("@"), "Enter a domain only (e.g. bulkfirepro.com).")
  .refine((d) => DOMAIN_RE.test(d), "Enter a valid domain (e.g. mail.yourcompany.com).");

export const isoDateField = z
  .string()
  .regex(ISO_DATE_RE, "Date must be YYYY-MM-DD.")
  .refine((d) => {
    const [y, m, day] = d.split("-").map(Number);
    const dt = new Date(Date.UTC(y, m - 1, day));
    return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === day;
  }, "Date is not valid.");

export const base64Field = (maxLen: number) =>
  z
    .string()
    .min(1, "Value is required.")
    .max(maxLen, `Value must be at most ${maxLen} characters.`)
    .refine((s) => !/\s/.test(s), "Base64 must not contain whitespace.")
    .refine((s) => BASE64_RE.test(s), "Value must be valid base64.");

export const attachmentFilenameField = z
  .string()
  .min(1, "Filename is required.")
  .max(200, "Filename must be at most 200 characters.")
  .refine((s) => !/[\\/]/.test(s), "Filename must not contain path separators.")
  .refine((s) => s !== "." && s !== "..", "Filename is invalid.")
  .refine((s) => !s.includes(".."), "Filename is invalid.");

export const planIdField = z
  .string()
  .min(1, "Plan id is required.")
  .max(32, "Plan id is invalid.")
  .regex(/^p\d+$/, "Unknown plan id format.");
