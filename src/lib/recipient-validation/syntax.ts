import { emailField } from "@/lib/validation";

const ROLE_LOCAL_PARTS = new Set([
  "abuse",
  "admin",
  "billing",
  "contact",
  "help",
  "hostmaster",
  "info",
  "mailer-daemon",
  "marketing",
  "newsletter",
  "no-reply",
  "noreply",
  "postmaster",
  "root",
  "sales",
  "security",
  "support",
  "unsubscribe",
  "webmaster",
]);

export type ValidationReason =
  | "invalid_syntax"
  | "disposable"
  | "no_mx"
  | "suppressed"
  | "role_address";

export type RecipientValidationResult = {
  email: string;
  ok: boolean;
  reasons: ValidationReason[];
};

export function normalizeRecipientEmail(raw: string): string {
  return raw.trim().toLowerCase();
}

export function domainFromEmail(email: string): string | null {
  const at = email.lastIndexOf("@");
  if (at < 1) return null;
  const domain = email.slice(at + 1).trim().toLowerCase();
  return domain.length > 0 ? domain : null;
}

export function checkEmailSyntax(email: string): boolean {
  return emailField.safeParse(email).success;
}

export function isRoleAddress(email: string): boolean {
  const at = email.indexOf("@");
  if (at < 1) return false;
  const local = email.slice(0, at).trim().toLowerCase();
  if (ROLE_LOCAL_PARTS.has(local)) return true;
  if (local.startsWith("noreply") || local.startsWith("no-reply")) return true;
  return false;
}

export function humanReason(reason: ValidationReason): string {
  switch (reason) {
    case "invalid_syntax":
      return "Invalid email syntax";
    case "disposable":
      return "Disposable / throwaway domain";
    case "no_mx":
      return "Domain has no MX records";
    case "suppressed":
      return "Previously suppressed (bounce / unsubscribe)";
    case "role_address":
      return "Role address (high bounce risk)";
    default:
      return reason;
  }
}
