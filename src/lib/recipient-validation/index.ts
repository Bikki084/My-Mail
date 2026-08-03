import type { SupabaseClient } from "@supabase/supabase-js";
import { isDisposableDomain } from "@/lib/recipient-validation/disposable-domains";
import { resolveMxForDomains } from "@/lib/recipient-validation/mx-check";
import {
  checkEmailSyntax,
  domainFromEmail,
  humanReason,
  isRoleAddress,
  normalizeRecipientEmail,
  type RecipientValidationResult,
  type ValidationReason,
} from "@/lib/recipient-validation/syntax";
import { loadSuppressedEmails } from "@/lib/recipient-suppression";

export type ValidateRecipientsOptions = {
  /** When true, role addresses (info@, noreply@) are blocked. Default: true. */
  blockRoleAddresses?: boolean;
  /** When true, run DNS MX lookups (cached). Default: true. */
  checkMx?: boolean;
};

export type ValidateRecipientsSummary = {
  results: RecipientValidationResult[];
  okCount: number;
  blockedCount: number;
};

const DEFAULT_OPTS: Required<ValidateRecipientsOptions> = {
  blockRoleAddresses: true,
  checkMx: true,
};

/**
 * Validate a batch of emails before send. Provider-agnostic — syntax, disposable
 * domains, MX (DNS), and tenant suppression list only (no SendGrid/ZeroBounce API).
 */
export async function validateRecipients(
  supabase: SupabaseClient,
  userId: string,
  rawEmails: string[],
  opts: ValidateRecipientsOptions = {},
): Promise<ValidateRecipientsSummary> {
  const options = { ...DEFAULT_OPTS, ...opts };
  const normalized = rawEmails.map(normalizeRecipientEmail).filter(Boolean);
  const unique = [...new Set(normalized)];

  const suppressed = await loadSuppressedEmails(supabase, userId);

  const domainsNeeded: string[] = [];
  for (const email of unique) {
    const domain = domainFromEmail(email);
    if (domain) domainsNeeded.push(domain);
  }

  const mxMap =
    options.checkMx && domainsNeeded.length > 0
      ? await resolveMxForDomains(domainsNeeded, supabase)
      : new Map<string, boolean>();

  const results: RecipientValidationResult[] = [];

  for (const email of unique) {
    const reasons: ValidationReason[] = [];

    if (!checkEmailSyntax(email)) {
      reasons.push("invalid_syntax");
    }

    if (suppressed.has(email)) {
      reasons.push("suppressed");
    }

    const domain = domainFromEmail(email);
    if (domain && isDisposableDomain(domain)) {
      reasons.push("disposable");
    }

    if (options.blockRoleAddresses && isRoleAddress(email)) {
      reasons.push("role_address");
    }

    if (options.checkMx && domain && !reasons.includes("invalid_syntax")) {
      const hasMx = mxMap.get(domain);
      if (hasMx === false) {
        reasons.push("no_mx");
      }
    }

    results.push({
      email,
      ok: reasons.length === 0,
      reasons,
    });
  }

  const okCount = results.filter((r) => r.ok).length;
  return {
    results,
    okCount,
    blockedCount: results.length - okCount,
  };
}

export function validationResultMap(
  summary: ValidateRecipientsSummary,
): Map<string, RecipientValidationResult> {
  return new Map(summary.results.map((r) => [r.email, r]));
}

export function formatBlockedReasons(reasons: ValidationReason[]): string {
  return reasons.map(humanReason).join("; ");
}

export { humanReason };
