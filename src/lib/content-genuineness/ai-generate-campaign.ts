import "server-only";

import { APP_BRAND_NAME } from "@/lib/brand";
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
  const company = input.senderName || APP_BRAND_NAME;
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

${SHARED_PHISHING_CONSTRAINTS}

${
  financial
    ? "This IS a billing email. Put the SAME invoice_number, transaction_id, renewal_date, and amount in subject, body, AND attachment."
    : "This is NOT a billing email. Do not mention invoices, transaction IDs, amounts due, renewal dates, or payment. Attachment must match the body topic (letter/status summary), not an invoice PDF."
}

Rules:
- Return JSON only:
  {"canonical":{...},"subject":"...","bodyHtml":"<p>...</p>","attachmentHtml":"<div>...</div>"}
- Greet with {{{name}}}, never "Dear Customer".
- Company/sender: ${company}
- Keep HTML compact. Attachment must describe the same event as the body.

User brief:
${input.brief.slice(0, 4000)}`;
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
  return null;
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
        senderName: input.senderName,
      });

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
      senderName: input.senderName,
      contentType,
      canonical,
      retryNote,
    });

    const result = await generateGeminiJsonText(prompt, { preferLite: true });
    if (!result.ok) {
      attempts.push({ attempt, contentType, parseOk: false, localReject: result.reason });
      return { ok: false, reason: humanizeGeminiFailure(result.reason), attempts };
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

    const local = localRejectReason(
      contentType,
      parsed.subject,
      parsed.bodyHtml,
      parsed.attachmentHtml,
    );
    if (local) {
      attempts.push({ attempt, contentType, parseOk: true, localReject: local });
      retryNote = local;
      lastGood = {
        subject: parsed.subject,
        bodyHtml: parsed.bodyHtml,
        attachmentHtml: parsed.attachmentHtml,
        canonical,
        verdict: null,
      };
      continue;
    }

    const bodyPlain = htmlToPlainText(parsed.bodyHtml);
    const attachmentPlain = htmlToPlainText(parsed.attachmentHtml);
    const verdict = await runGeminiPhishingValidation({
      subject: parsed.subject,
      bodyPlain,
      attachmentPlain,
      senderName: input.senderName,
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
      subject: parsed.subject,
      bodyHtml: parsed.bodyHtml,
      attachmentHtml: parsed.attachmentHtml,
      canonical,
      verdict,
    };

    if (!phishingVerdictBlocksSend(verdict)) {
      return {
        ok: true,
        subject: parsed.subject.trim(),
        bodyHtml: parsed.bodyHtml.trim(),
        attachmentHtml: parsed.attachmentHtml.trim(),
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
    return {
      ok: false,
      reason: "Could not generate a valid campaign after 3 attempts.",
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
