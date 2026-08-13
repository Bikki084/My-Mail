import "server-only";

import { APP_NOREPLY_EMAIL, APP_PUBLIC_URL, APP_BRAND_NAME } from "@/lib/brand";
import { buildCanonicalContentFields } from "@/lib/content-genuineness/canonical-fields";
import {
  generateGeminiJsonText,
  humanizeGeminiFailure,
} from "@/lib/gemini/client";

export type AiGeneratedCampaign = {
  ok: true;
  subject: string;
  bodyHtml: string;
  attachmentHtml: string;
  canonicalFields: ReturnType<typeof buildCanonicalContentFields> | null;
} | { ok: false; reason: string };

const INVOICE_LIKE =
  /\b(invoice|txn|transaction|renewal|subscription|billing|payment|amount due|plan)\b/i;

function looksInvoiceLike(brief: string): boolean {
  return INVOICE_LIKE.test(brief);
}

function parseGenerated(text: string): {
  subject?: string;
  bodyHtml?: string;
  attachmentHtml?: string;
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
  };
}

function buildPrompt(input: {
  brief: string;
  senderName: string;
  invoiceMode: boolean;
  canonicalJson: string | null;
  retryNote?: string;
}): string {
  const company = input.senderName || APP_BRAND_NAME;
  const retry = input.retryNote
    ? `\nPREVIOUS ATTEMPT FAILED: ${input.retryNote}\nReturn valid JSON only. Escape quotes in HTML. Keep HTML short.\n`
    : "";

  if (input.invoiceMode && input.canonicalJson) {
    return `Generate a professional email campaign from this user brief.
Use ONE shared set of facts — never invent different invoice/transaction/date values across artifacts.
${retry}
CANONICAL_FIELDS (use these EXACT literal values in subject, body, AND attachment):
${input.canonicalJson}

Rules:
- Return JSON only with exactly these keys: {"subject":"...","bodyHtml":"<p>...</p>","attachmentHtml":"<div>...</div>"}
- bodyHtml: simple <p> tags, personalized greeting with {{{name}}}
- attachmentHtml: standalone document using the SAME invoice/txn/date values
- Include support: ${APP_NOREPLY_EMAIL} · ${APP_PUBLIC_URL}
- Company: ${company}
- No urgency/scam language. No "Dear Customer".

User brief:
${input.brief.slice(0, 4000)}`;
  }

  return `Generate a professional, non-promotional email from this user brief.
Do NOT invent invoices, transaction IDs, renewal dates, fake payments, or scam-style notices.
${retry}
Rules:
- Return JSON only with exactly these keys: {"subject":"...","bodyHtml":"<p>...</p>","attachmentHtml":"<div>...</div>"}
- subject: specific, genuine, no clickbait
- bodyHtml: several <p> tags. Greet with {{{name}}}. Write a real message matching the brief. Include support ${APP_NOREPLY_EMAIL}.
- attachmentHtml: a short matching letter/summary using the SAME facts as the body (not an invoice unless the brief asks for one)
- Company/sender: ${company}
- No "Dear Customer", no urgency, no "see attached" filler.

User brief:
${input.brief.slice(0, 4000)}`;
}

/** AI-Generate mode: one Gemini call produces subject + body + attachment from a brief. */
export async function generateCampaignFromBrief(input: {
  brief: string;
  senderName: string;
  mergeTags?: string[];
}): Promise<AiGeneratedCampaign> {
  const invoiceMode = looksInvoiceLike(input.brief);
  const canonical = invoiceMode
    ? buildCanonicalContentFields({
        subject: input.brief,
        plainBody: input.brief,
        attachmentText: null,
        senderName: input.senderName,
        mergeTags: input.mergeTags ?? [],
      })
    : null;

  let retryNote: string | undefined;
  for (let attempt = 0; attempt < 2; attempt++) {
    const prompt = buildPrompt({
      brief: input.brief,
      senderName: input.senderName,
      invoiceMode,
      canonicalJson: canonical ? JSON.stringify(canonical, null, 2) : null,
      retryNote,
    });

    const result = await generateGeminiJsonText(prompt, { preferLite: true });
    if (!result.ok) {
      return { ok: false, reason: humanizeGeminiFailure(result.reason) };
    }

    const parsed = parseGenerated(result.text);
    if (parsed?.subject && parsed.bodyHtml && parsed.attachmentHtml) {
      return {
        ok: true,
        subject: parsed.subject.trim(),
        bodyHtml: parsed.bodyHtml.trim(),
        attachmentHtml: parsed.attachmentHtml.trim(),
        canonicalFields: canonical,
      };
    }

    console.error(
      "[ai-generate] unparseable Gemini JSON (attempt",
      attempt + 1,
      "):",
      result.text.slice(0, 800),
    );
    retryNote =
      "Response was missing subject, bodyHtml, or attachmentHtml, or was invalid JSON. " +
      "Reply with a compact JSON object only.";
  }

  return {
    ok: false,
    reason:
      "Gemini returned a campaign we could not read as JSON. Try a more specific brief, or write the email in Manual mode.",
  };
}
