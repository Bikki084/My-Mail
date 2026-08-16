import "server-only";

import {
  APP_BRAND_NAME,
  APP_BRAND_WRONG_LETTER_ORDER,
  APP_DOMAIN,
  APP_NOREPLY_EMAIL,
  APP_PUBLIC_URL,
  applyCanonicalBrandName,
  resolveCanonicalCompanyName,
} from "@/lib/brand";
import { buildCanonicalContentFields } from "@/lib/content-genuineness/canonical-fields";
import {
  classifyContentType,
  contentTypeAllowsFinancialFields,
  fieldSetForContentType,
  seedCanonicalForType,
  SHARED_PHISHING_CONSTRAINTS,
  textHasFinancialFields,
  type CampaignContentType,
} from "@/lib/content-genuineness/content-type";
import {
  phishingVerdictBlocksSend,
  runGeminiPhishingValidation,
  type PhishingValidationResult,
} from "@/lib/content-genuineness/gemini-phishing-validator";
import {
  generateGeminiJsonText,
  humanizeGeminiFailure,
} from "@/lib/gemini/client";
import { htmlToPlainText } from "@/lib/html-email";
import { checkSubjectBodyAlignment } from "@/lib/content-genuineness/checks";

export type GenerateAttemptLog = {
  attempt: number;
  contentType: CampaignContentType;
  parseOk: boolean;
  localReject?: string;
  phishingStatus?: PhishingValidationResult["status"];
  phishingReasoning?: string;
  flags?: string[];
};

export type AiGeneratedCampaign = {
  ok: true;
  subject: string;
  bodyHtml: string;
  attachmentHtml: string;
  contentType: CampaignContentType;
  canonical: Record<string, string>;
  passedVerification: boolean;
  phishingVerdict: PhishingValidationResult | null;
  attempts: GenerateAttemptLog[];
} | { ok: false; reason: string; attempts: GenerateAttemptLog[] };

function parseGenerated(text: string): {
  subject?: string;
  bodyHtml?: string;
  attachmentHtml?: string;
  canonical?: Record<string, string>;
} | null {
  const trimmed = text.trim();
  const fence = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const raw = fence ? fence[1]!.trim() : trimmed;

  const tryParse = (s: string): Record<string, unknown> | null => {
    try {
      return JSON.parse(s) as Record<string, unknown>;
    } catch {
      const start = s.indexOf("{");
      const end = s.lastIndexOf("}");
      if (start >= 0 && end > start) {
        try {
          return JSON.parse(s.slice(start, end + 1)) as Record<string, unknown>;
        } catch {
          return null;
        }
      }
      return null;
    }
  };

  const obj = tryParse(raw);
  if (!obj) return null;

  const str = (...keys: string[]): string | undefined => {
    for (const k of keys) {
      const v = obj[k];
      if (typeof v === "string" && v.trim()) return v.trim();
    }
    return undefined;
  };

  const canonicalRaw = obj.canonical;
  const canonical =
    canonicalRaw && typeof canonicalRaw === "object" && !Array.isArray(canonicalRaw)
      ? Object.fromEntries(
          Object.entries(canonicalRaw as Record<string, unknown>).map(([k, v]) => [
            k,
            String(v ?? ""),
          ]),
        )
      : undefined;

  return {
    subject: str("subject", "subjectLine", "subject_line"),
    bodyHtml: str("bodyHtml", "body_html", "html", "body"),
    attachmentHtml: str(
      "attachmentHtml",
      "attachment_html",
      "attachment",
      "pdfHtml",
      "pdf_html",
    ),
    canonical,
  };
}

function buildGeneratePrompt(input: {
  brief: string;
  senderName: string;
  contentType: CampaignContentType;
  canonical: Record<string, string>;
  retryNote?: string;
}): string {
  const company = resolveCanonicalCompanyName(
    input.canonical.company_name || input.senderName || APP_BRAND_NAME,
  );
  const financial = contentTypeAllowsFinancialFields(input.contentType);
  const retry = input.retryNote
    ? `\nPREVIOUS ATTEMPT FAILED VERIFICATION. Fix these issues and regenerate ALL three artifacts from the same canonical object:\n${input.retryNote}\n`
    : "";

  return `You generate a complete email campaign in ONE response: canonical object + subject + HTML body + HTML attachment.
content_type = ${input.contentType}
Allowed canonical keys for this type: ${fieldSetForContentType(input.contentType).join(", ")}
${retry}
Use this canonical object as the single source of truth (you may fill empty non-financial details, but you MUST keep these keys; do not add invoice/txn/amount/renewal unless content_type is invoice or renewal_notice):
${JSON.stringify(input.canonical, null, 2)}

COMPANY NAME (verbatim — copy this exact string everywhere):
"${company}"
- Do not rearrange letters. Never write "${APP_BRAND_WRONG_LETTER_ORDER}" or any other permutation.
- Use this exact capitalization in subject, body, and attachment prose.
- URLs and email addresses may use ${APP_DOMAIN}; that is the hostname, not a substitute for omitting "${company}" in the text.
- Do not append Inc., Ltd., or shorten the name.

${SHARED_PHISHING_CONSTRAINTS}

${
  financial
    ? "This IS a billing email. Put the SAME invoice_number, transaction_id, renewal_date, and amount in subject, body, AND attachment."
    : "This is NOT a billing email. Do not mention invoices, transaction IDs, amounts due, renewal dates, or payment. Attachment must match the body topic (letter/status summary), not an invoice PDF."
}
${
  input.contentType === "password_reset"
    ? `This is a legitimate first-party notice from ${company} (not an attack). Do not include clickable reset URLs or "click here". Tell the recipient to sign in at ${APP_PUBLIC_URL} if they requested a password change. No urgency language.`
    : ""
}

Rules:
- Return JSON only:
  {"canonical":{...},"subject":"...","bodyHtml":"<p>...</p>","attachmentHtml":"<div>...</div>"}
- Greet with {{{name}}}, never "Dear Customer".
- Company/sender display name must appear exactly as: ${company}
- Reuse the same topic words in the subject and the body (do not write a subject about one event and a body about another).
- Keep HTML compact. Attachment must describe the same event as the body.

User brief:
${input.brief.slice(0, 4000)}`;
}

function localFallbackCampaign(input: {
  contentType: CampaignContentType;
  canonical: Record<string, string>;
  senderName: string;
}): { subject: string; bodyHtml: string; attachmentHtml: string } {
  const company = resolveCanonicalCompanyName(
    input.canonical.company_name || input.senderName || APP_BRAND_NAME,
  );
  const support = input.canonical.support_contact || `${APP_NOREPLY_EMAIL} · ${APP_PUBLIC_URL}`;
  const testId = input.canonical.test_id || "CONN-LOCAL";
  const ts = input.canonical.timestamp || new Date().toISOString();

  switch (input.contentType) {
    case "password_reset":
      return {
        subject: `${company} account recovery notice`,
        bodyHtml: `<p>Hi {{{name}}},</p><p>We received a request to change the password on your ${company} account. If you made this request, sign in at ${APP_PUBLIC_URL} and update your password from account settings. If you did not make this request, you can ignore this message — no change has been made.</p><p>Support: ${support}</p>`,
        attachmentHtml: `<div><h1>${company} account recovery</h1><p>Recipient: {{{name}}}</p><p>Action: password change request received. No payment is involved. Visit ${APP_PUBLIC_URL} only if you initiated this request.</p><p>${support}</p></div>`,
      };
    case "welcome_email":
      return {
        subject: `Welcome to ${company}`,
        bodyHtml: `<p>Hi {{{name}}},</p><p>Your ${company} account is ready. You can sign in at ${APP_PUBLIC_URL} whenever you need to send or review campaigns.</p><p>If you have questions, write to ${support}.</p>`,
        attachmentHtml: `<div><h1>Welcome</h1><p>This note confirms {{{name}}} has access to ${company}.</p><p>${support}</p></div>`,
      };
    case "connectivity_test":
      return {
        subject: `${company} connectivity test ${testId}`,
        bodyHtml: `<p>Hi {{{name}}},</p><p>This is a connectivity test from ${company}. Test ID ${testId} completed at ${ts} with status ${input.canonical.status || "OK"}. No invoice or payment is involved.</p><p>If you received this as expected, your mailbox path is working. Support: ${support}</p>`,
        attachmentHtml: `<div><h1>${company} connectivity test</h1><p>Test ID: ${testId}</p><p>Timestamp: ${ts}</p><p>Status: ${input.canonical.status || "OK"}</p><p>${support}</p></div>`,
      };
    default:
      return {
        subject: `${company} notice`,
        bodyHtml: `<p>Hi {{{name}}},</p><p>${company} is sending this notice to confirm your mailbox is reachable. No payment or account action is required.</p><p>Support: ${support}</p>`,
        attachmentHtml: `<div><h1>${company} notice</h1><p>For {{{name}}}. No invoice or transaction is attached.</p><p>${support}</p></div>`,
      };
  }
}

function localRejectReason(
  type: CampaignContentType,
  subject: string,
  bodyHtml: string,
  attachmentHtml: string,
): string | null {
  const blob = `${subject}\n${htmlToPlainText(bodyHtml)}\n${htmlToPlainText(attachmentHtml)}`;
  if (!contentTypeAllowsFinancialFields(type) && textHasFinancialFields(blob)) {
    return `content_type is ${type} but generated text includes invoice/transaction/amount/renewal fields — omit all financial fields and match the user brief.`;
  }
  if (contentTypeAllowsFinancialFields(type) && !textHasFinancialFields(blob)) {
    return `content_type is ${type} but invoice/amount fields are missing from body or attachment.`;
  }
  const align = checkSubjectBodyAlignment(subject, bodyHtml);
  if (align.length > 0) {
    return `${align[0]!.message} Put the same topic words in the subject and the body.`;
  }
  return null;
}

function applySeededBrand(
  seededCompany: string,
  canonical: Record<string, string>,
  subject: string,
  bodyHtml: string,
  attachmentHtml: string,
): {
  canonical: Record<string, string>;
  subject: string;
  bodyHtml: string;
  attachmentHtml: string;
} {
  return {
    canonical: { ...canonical, company_name: seededCompany },
    subject: applyCanonicalBrandName(subject, seededCompany),
    bodyHtml: applyCanonicalBrandName(bodyHtml, seededCompany),
    attachmentHtml: applyCanonicalBrandName(attachmentHtml, seededCompany),
  };
}

/**
 * Classify → generate (one call) → verify → retry up to 2 times with verifier feedback.
 */
export async function generateCampaignFromBrief(input: {
  brief: string;
  senderName: string;
  mergeTags?: string[];
}): Promise<AiGeneratedCampaign> {
  const contentType = await classifyContentType(input.brief);
  const financial = contentTypeAllowsFinancialFields(contentType);
  const seededCompany = resolveCanonicalCompanyName(input.senderName);

  let canonical: Record<string, string> = financial
    ? (buildCanonicalContentFields({
        subject: input.brief,
        plainBody: input.brief,
        attachmentText: null,
        senderName: input.senderName,
        mergeTags: input.mergeTags ?? [],
        allowInventedFinancialFields: true,
      }) as unknown as Record<string, string>)
    : seedCanonicalForType({
        type: contentType,
        brief: input.brief,
        senderName: seededCompany,
      });

  canonical.company_name = seededCompany;

  const attempts: GenerateAttemptLog[] = [];
  let lastGood: {
    subject: string;
    bodyHtml: string;
    attachmentHtml: string;
    canonical: Record<string, string>;
    verdict: PhishingValidationResult | null;
  } | null = null;
  let retryNote: string | undefined;

  for (let attempt = 1; attempt <= 3; attempt++) {
    const prompt = buildGeneratePrompt({
      brief: input.brief,
      senderName: seededCompany,
      contentType,
      canonical,
      retryNote,
    });

    const result = await generateGeminiJsonText(prompt, { preferLite: true });
    if (!result.ok) {
      attempts.push({ attempt, contentType, parseOk: false, localReject: result.reason });
      retryNote = `Gemini call failed (${result.reason}). Retry with compact JSON only.`;
      continue;
    }

    const parsed = parseGenerated(result.text);
    if (!parsed?.subject || !parsed.bodyHtml || !parsed.attachmentHtml) {
      console.error("[ai-generate] unparseable JSON attempt", attempt, result.text.slice(0, 600));
      attempts.push({ attempt, contentType, parseOk: false, localReject: "unparseable JSON" });
      retryNote = "Response was invalid JSON or missing subject/bodyHtml/attachmentHtml. Return compact JSON only.";
      continue;
    }

    if (parsed.canonical && Object.keys(parsed.canonical).length > 0) {
      canonical = { ...canonical, ...parsed.canonical };
    }

    const branded = applySeededBrand(
      seededCompany,
      canonical,
      parsed.subject,
      parsed.bodyHtml,
      parsed.attachmentHtml,
    );
    canonical = branded.canonical;

    const local = localRejectReason(
      contentType,
      branded.subject,
      branded.bodyHtml,
      branded.attachmentHtml,
    );
    if (local) {
      attempts.push({ attempt, contentType, parseOk: true, localReject: local });
      retryNote = local;
      lastGood = {
        subject: branded.subject,
        bodyHtml: branded.bodyHtml,
        attachmentHtml: branded.attachmentHtml,
        canonical,
        verdict: null,
      };
      continue;
    }

    const bodyPlain = htmlToPlainText(branded.bodyHtml);
    const attachmentPlain = htmlToPlainText(branded.attachmentHtml);
    const verdict = await runGeminiPhishingValidation({
      subject: branded.subject,
      bodyPlain,
      attachmentPlain,
      senderName: seededCompany,
      hasAttachment: true,
    });

    attempts.push({
      attempt,
      contentType,
      parseOk: true,
      phishingStatus: verdict.status,
      phishingReasoning: verdict.reasoning,
      flags: verdict.flags,
    });

    lastGood = {
      subject: branded.subject,
      bodyHtml: branded.bodyHtml,
      attachmentHtml: branded.attachmentHtml,
      canonical,
      verdict,
    };

    if (!phishingVerdictBlocksSend(verdict)) {
      return {
        ok: true,
        subject: branded.subject.trim(),
        bodyHtml: branded.bodyHtml.trim(),
        attachmentHtml: branded.attachmentHtml.trim(),
        contentType,
        canonical,
        passedVerification: true,
        phishingVerdict: verdict,
        attempts,
      };
    }

    const mismatchLines = verdict.mismatches_found
      .map((m) => `- ${m.field}: body "${m.body_value}" vs attachment "${m.attachment_value}"`)
      .join("\n");
    retryNote = [
      `Verifier status=${verdict.status}: ${verdict.reasoning}`,
      verdict.flags.length ? `Flags: ${verdict.flags.join("; ")}` : "",
      mismatchLines,
      !financial
        ? "Regenerate with ZERO invoice/transaction/amount/renewal fields. Attachment must match the body topic."
        : "Regenerate so invoice/txn/date/amount are identical in subject, body, and attachment.",
    ]
      .filter(Boolean)
      .join("\n");
  }

  if (!lastGood) {
    if (!financial) {
      const fb = localFallbackCampaign({ contentType, canonical, senderName: seededCompany });
      const brandedFb = applySeededBrand(
        seededCompany,
        canonical,
        fb.subject,
        fb.bodyHtml,
        fb.attachmentHtml,
      );
      canonical = brandedFb.canonical;
      const verdict = await runGeminiPhishingValidation({
        subject: brandedFb.subject,
        bodyPlain: htmlToPlainText(brandedFb.bodyHtml),
        attachmentPlain: htmlToPlainText(brandedFb.attachmentHtml),
        senderName: seededCompany,
        hasAttachment: true,
      });
      attempts.push({
        attempt: attempts.length + 1,
        contentType,
        parseOk: true,
        localReject: "used local fallback after Gemini generate failures",
        phishingStatus: verdict.status,
        phishingReasoning: verdict.reasoning,
        flags: verdict.flags,
      });
      return {
        ok: true,
        subject: brandedFb.subject,
        bodyHtml: brandedFb.bodyHtml,
        attachmentHtml: brandedFb.attachmentHtml,
        contentType,
        canonical,
        passedVerification: !phishingVerdictBlocksSend(verdict),
        phishingVerdict: verdict,
        attempts,
      };
    }
    return {
      ok: false,
      reason: humanizeGeminiFailure(
        attempts.map((a) => a.localReject).filter(Boolean).join(" ") ||
          "Could not generate a valid campaign after 3 attempts.",
      ),
      attempts,
    };
  }

  return {
    ok: true,
    subject: lastGood.subject.trim(),
    bodyHtml: lastGood.bodyHtml.trim(),
    attachmentHtml: lastGood.attachmentHtml.trim(),
    contentType,
    canonical,
    passedVerification: false,
    phishingVerdict: lastGood.verdict,
    attempts,
  };
}
