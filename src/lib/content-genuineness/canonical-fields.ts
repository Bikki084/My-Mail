/**
 * Single source of truth for dynamic fields used across subject, body, and
 * attachment rewrites — prevents phishing-like invoice/TXN/date mismatches.
 */

import { createHash } from "node:crypto";
import {
  APP_DOMAIN,
  APP_NOREPLY_EMAIL,
  APP_PUBLIC_URL,
  resolveCanonicalCompanyName,
} from "@/lib/brand";
import {
  formatTodayDateMmDdYyyy,
  generateInvoiceNumber,
  generateTransactionId,
} from "@/lib/built-in-merge-tags";

export type CanonicalContentFields = {
  recipient_name: string;
  invoice_number: string;
  transaction_id: string;
  renewal_date: string;
  plan_name: string;
  amount: string;
  company_name: string;
  support_contact: string;
};

export type CanonicalFieldKey = keyof CanonicalContentFields;

const TRACKED_KEYS: CanonicalFieldKey[] = [
  "invoice_number",
  "transaction_id",
  "renewal_date",
  "amount",
  "company_name",
];

function hashSeed(seed: string): number {
  let h = 2166136261;
  for (let i = 0; i < seed.length; i++) {
    h ^= seed.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function createRng(seed: string): () => number {
  let state = hashSeed(seed) || 1;
  return () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 0xffffffff;
  };
}

function uniqPreserve(values: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const v of values) {
    const key = v.trim().toLowerCase();
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push(v.trim());
  }
  return out;
}

const TRANSACTION_ID_STOPWORDS = new Set([
  "action",
  "number",
  "invoice",
  "payment",
  "details",
  "required",
  "customer",
]);

/** Reject English words misparsed from labels like "transaction ID is …". */
export function isPlausibleTransactionId(value: string): boolean {
  const v = value.trim().toUpperCase();
  if (v.length < 6) return false;
  if (TRANSACTION_ID_STOPWORDS.has(v.toLowerCase())) return false;
  if (/^\d{3}[A-Z]{3}\d{4}$/.test(v)) return true;
  if (/^TXN[- ]?[A-Z0-9]{5,18}$/.test(v)) return true;
  if (/^\d{7,12}$/.test(v)) return true;
  return /[A-Z]/.test(v) && /\d/.test(v);
}

/** Extract candidate dynamic values from free text / HTML. */
export function extractDynamicFieldCandidates(text: string): Partial<
  Record<CanonicalFieldKey, string[]>
> {
  const t = text.replace(/\u00a0/g, " ");
  const out: Partial<Record<CanonicalFieldKey, string[]>> = {};

  const invoices = [
    ...t.matchAll(
      /\b(?:invoice\s*(?:#|no\.?|number)?\s*[:#-]?\s*)((?:INV|BFP|INVOICE)[- ]?\d{4,}|[A-Z]{2,5}-\d{5,})\b/gi,
    ),
    ...t.matchAll(/\b((?:INV|BFP)-\d{5,})\b/gi),
  ].map((m) => m[1]!.replace(/\s+/g, "").toUpperCase());
  if (invoices.length) out.invoice_number = uniqPreserve(invoices);

  const txns = [
    ...t.matchAll(
      /\b(?:txn|transaction)\s+(?:id|#|number)\b\s*[:#-]?\s*(?:is\s+)?([A-Z0-9-]{6,20})\b/gi,
    ),
    ...t.matchAll(/\b(?:txn|transaction)\s+([A-Z0-9]{6,20})\b/gi),
    ...t.matchAll(/\bTXN[- ]?([A-Z0-9]{5,18})\b/gi),
    ...t.matchAll(/\b(\d{3}[A-Z]{3}\d{4})\b/g),
  ]
    .map((m) => m[1]!.replace(/\s+/g, "").toUpperCase())
    .filter((v) => isPlausibleTransactionId(v));
  if (txns.length) out.transaction_id = uniqPreserve(txns);

  const dates = [
    ...t.matchAll(
      /\b(?:renewal|due|expires?|valid\s+until|next\s+billing)\s*(?:date)?\s*[:#-]?\s*(\d{1,2}[\/\-]\d{1,2}[\/\-]\d{2,4}|\d{4}-\d{2}-\d{2})\b/gi,
    ),
    ...t.matchAll(/\b(\d{4}-\d{2}-\d{2})\b/g),
    ...t.matchAll(/\b(\d{1,2}\/\d{1,2}\/\d{4})\b/g),
  ].map((m) => m[1]!);
  if (dates.length) out.renewal_date = uniqPreserve(dates);

  const amounts = [
    ...t.matchAll(
      /\b(?:amount|total|due|price|charge[sd]?)\s*[:#-]?\s*(\$?\s?\d{1,3}(?:,\d{3})*(?:\.\d{2})?|\d+(?:\.\d{2})?\s*(?:USD|INR|EUR))\b/gi,
    ),
    ...t.matchAll(/(\$\s?\d{1,3}(?:,\d{3})*(?:\.\d{2})?)/g),
  ].map((m) => m[1]!.replace(/\s+/g, " ").trim());
  if (amounts.length) out.amount = uniqPreserve(amounts);

  const plans = [
    ...t.matchAll(
      /\b(?:plan|subscription|package)\s*[:#-]?\s*([A-Za-z][A-Za-z0-9 +_-]{2,40})\b/gi,
    ),
  ].map((m) => m[1]!.trim());
  if (plans.length) out.plan_name = uniqPreserve(plans);

  return out;
}

function mergeTagPlaceholder(keys: string[], preferred: string[]): string | null {
  const lower = new Set(keys.map((k) => k.toLowerCase()));
  for (const p of preferred) {
    const hit = keys.find((k) => k.toLowerCase() === p.toLowerCase());
    if (hit) return `{{{${hit}}}}`;
  }
  for (const k of keys) {
    if (preferred.some((p) => k.toLowerCase().includes(p.toLowerCase()))) {
      return `{{{${k}}}}`;
    }
  }
  void lower;
  return null;
}

function pickPreferred(
  attachmentVals: string[] | undefined,
  bodyVals: string[] | undefined,
  subjectVals: string[] | undefined,
): string | null {
  const a = attachmentVals ?? [];
  const b = bodyVals ?? [];
  const s = subjectVals ?? [];
  // Prefer a value that already appears in 2+ sources (already consistent).
  const counts = new Map<string, { display: string; n: number }>();
  for (const list of [a, b, s]) {
    for (const v of list) {
      const key = v.toLowerCase();
      const cur = counts.get(key);
      if (cur) cur.n += 1;
      else counts.set(key, { display: v, n: 1 });
    }
  }
  let best: { display: string; n: number } | null = null;
  for (const v of counts.values()) {
    if (!best || v.n > best.n) best = v;
  }
  if (best && best.n >= 2) return best.display;
  // Document of record: attachment → body → subject
  if (a[0]) return a[0];
  if (b[0]) return b[0];
  if (s[0]) return s[0];
  return null;
}

function toIsoDateHint(raw: string): string {
  const t = raw.trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(t)) return t;
  const mdy = t.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (mdy) {
    const mm = mdy[1]!.padStart(2, "0");
    const dd = mdy[2]!.padStart(2, "0");
    return `${mdy[3]}-${mm}-${dd}`;
  }
  return t;
}

export function buildCanonicalContentFields(input: {
  subject: string;
  plainBody: string;
  attachmentText: string | null;
  senderName: string;
  mergeTags?: string[];
  /** Stable seed so regenerate retries keep the same invented IDs. */
  seed?: string;
  /** When false (default), do not invent invoice/txn/renewal unless already in the source. */
  allowInventedFinancialFields?: boolean;
}): CanonicalContentFields {
  const mergeTags = input.mergeTags ?? [];
  const subjectC = extractDynamicFieldCandidates(input.subject);
  const bodyC = extractDynamicFieldCandidates(input.plainBody);
  const attC = extractDynamicFieldCandidates(input.attachmentText ?? "");

  const seed =
    input.seed ??
    createHash("sha256")
      .update(
        `${input.subject}\n${input.plainBody}\n${input.attachmentText ?? ""}\n${input.senderName}`,
      )
      .digest("hex")
      .slice(0, 24);
  const rng = createRng(seed);

  const invoiceFromMerge = mergeTagPlaceholder(mergeTags, [
    "invoice_number",
    "invoice",
    "invoice_no",
  ]);
  const txnFromMerge = mergeTagPlaceholder(mergeTags, [
    "transaction_id",
    "txn",
    "transaction",
  ]);
  const dateFromMerge = mergeTagPlaceholder(mergeTags, ["date", "renewal_date", "due_date"]);
  const nameFromMerge = mergeTagPlaceholder(mergeTags, [
    "name",
    "first_name",
    "full_name",
    "recipient_name",
  ]);
  const amountFromMerge = mergeTagPlaceholder(mergeTags, ["amount", "total", "price"]);
  const planFromMerge = mergeTagPlaceholder(mergeTags, ["plan", "plan_name", "subscription"]);

  // Tracked invoice/txn/date/amount MUST be identical literals in subject, body, and
  // attachment — never merge-tag placeholders (those expand per-recipient and caused
  // body/PDF mismatches in preview).
  void invoiceFromMerge;
  void txnFromMerge;
  void dateFromMerge;
  void amountFromMerge;
  void planFromMerge;

  const amount =
    pickPreferred(attC.amount, bodyC.amount, subjectC.amount) ?? "";

  const plan_name =
    pickPreferred(attC.plan_name, bodyC.plan_name, subjectC.plan_name) ?? "";

  const sourceLooksFinancial = Boolean(
    pickPreferred(attC.invoice_number, bodyC.invoice_number, subjectC.invoice_number) ||
      pickPreferred(attC.transaction_id, bodyC.transaction_id, subjectC.transaction_id) ||
      /\b(invoice|billing|payment|renewal|subscription)\b/i.test(
        `${input.subject}\n${input.plainBody}\n${input.attachmentText ?? ""}`,
      ),
  );
  const inventFinancial = input.allowInventedFinancialFields === true || sourceLooksFinancial;

  const invoice_number =
    pickPreferred(attC.invoice_number, bodyC.invoice_number, subjectC.invoice_number) ??
    (inventFinancial ? generateInvoiceNumber(rng) : "");

  const transaction_id =
    pickPreferred(attC.transaction_id, bodyC.transaction_id, subjectC.transaction_id) ??
    (inventFinancial ? generateTransactionId(rng) : "");

  const renewalRaw = pickPreferred(
    attC.renewal_date,
    bodyC.renewal_date,
    subjectC.renewal_date,
  );
  const renewal_date = renewalRaw
    ? toIsoDateHint(renewalRaw)
    : inventFinancial
      ? toIsoDateHint(formatTodayDateMmDdYyyy())
      : "";

  const company_name = resolveCanonicalCompanyName(input.senderName);

  const support_contact = `${APP_NOREPLY_EMAIL} · ${APP_PUBLIC_URL}`;

  const recipient_name = nameFromMerge ?? "";

  return {
    recipient_name,
    invoice_number,
    transaction_id,
    renewal_date,
    plan_name,
    amount,
    company_name,
    support_contact,
  };
}

export function canonicalFieldsPromptBlock(fields: CanonicalContentFields): string {
  const present = Object.fromEntries(
    Object.entries(fields).filter(([, v]) => String(v ?? "").trim().length > 0),
  );
  const hasFinancial = Boolean(
    String(fields.invoice_number ?? "").trim() || String(fields.transaction_id ?? "").trim(),
  );
  return `CANONICAL_FIELDS (use these EXACT values verbatim in subject, body, and attachment — never invent alternatives):
${JSON.stringify(present, null, 2)}

Rules for CANONICAL_FIELDS:
${
  hasFinancial
    ? "- Copy invoice_number, transaction_id, renewal_date, amount, company_name, support_contact exactly as written.\n- Do not paraphrase IDs or invent new INV-/TXN-/BFP- numbers."
    : "- Do NOT invent invoice numbers, transaction IDs, amounts, or renewal dates. Those fields are omitted on purpose."
}
- Copy company_name exactly as written ("${fields.company_name}"). Do not rearrange letters. URLs may use ${APP_DOMAIN}; prose must still include the display name.
- If recipient_name is a {{{tag}}}, use it in the greeting; never fall back to "Dear Customer" when a name tag is available.
- support_contact must appear in the body (and attachment when rewritten) — never omit or replace with vague "contact support".`;
}

/** Lightweight fingerprint for audit logs (no secrets beyond compose fields). */
export function canonicalFieldsAuditId(fields: CanonicalContentFields): string {
  return createHash("sha256")
    .update(JSON.stringify(fields))
    .digest("hex")
    .slice(0, 16);
}

export { TRACKED_KEYS };
