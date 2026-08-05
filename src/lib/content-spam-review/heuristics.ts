import { htmlToPlainText } from "@/lib/html-email";

export type ContentRiskLevel = "low" | "medium" | "high";

export type HeuristicIssue = {
  code: string;
  message: string;
  weight: number;
};

const SPAM_PHRASES = [
  /\bfree\b/i,
  /\bact now\b/i,
  /\blimited time\b/i,
  /\bclick here\b/i,
  /\b100%\s*free\b/i,
  /\bwinner\b/i,
  /\bcongratulations\b/i,
  /\bverify your account\b/i,
  /\bsuspended account\b/i,
  /\burgent\b/i,
  /\bno obligation\b/i,
  /\brisk[\s-]*free\b/i,
  /\bguarantee\b/i,
  /\bmake money\b/i,
  /\bwork from home\b/i,
  /\bcrypto\b/i,
  /\bbitcoin\b/i,
  /\bweight loss\b/i,
  /\bviagra\b/i,
  /\bcasino\b/i,
  /\blottery\b/i,
  /\bdear (customer|friend|user)\b/i,
  /\bopen immediately\b/i,
  /\bfinal notice\b/i,
  /\blast chance\b/i,
];

const URL_SHORTENERS = /bit\.ly|tinyurl|t\.co|goo\.gl|ow\.ly|is\.gd|buff\.ly/i;

function countLinks(text: string): number {
  const matches = text.match(/https?:\/\/[^\s<>"']+/gi);
  return matches?.length ?? 0;
}

function capsRatio(s: string): number {
  const letters = s.replace(/[^a-zA-Z]/g, "");
  if (letters.length < 4) return 0;
  const upper = letters.replace(/[^A-Z]/g, "").length;
  return upper / letters.length;
}

export function analyzeContentHeuristics(input: {
  subject: string;
  bodyHtml: string;
  senderName: string;
}): { score: number; level: ContentRiskLevel; issues: HeuristicIssue[] } {
  const subject = input.subject.trim();
  const plainBody = htmlToPlainText(input.bodyHtml ?? "").trim();
  const combined = `${subject}\n${plainBody}`;
  const issues: HeuristicIssue[] = [];

  if (subject.length === 0) {
    issues.push({ code: "empty_subject", message: "Subject is empty.", weight: 25 });
  }
  if (plainBody.length === 0) {
    issues.push({ code: "empty_body", message: "Email body has no readable text.", weight: 40 });
  }

  if (plainBody.length > 0 && plainBody.split(/\s+/).length < 25) {
    issues.push({
      code: "thin_body",
      message: "Body is very short — attachment-only or one-liner emails often trigger spam filters.",
      weight: 22,
    });
  }

  const subCaps = capsRatio(subject);
  if (subCaps > 0.6 && subject.length > 5) {
    issues.push({
      code: "subject_all_caps",
      message: "Subject uses mostly CAPITAL letters — a common spam signal.",
      weight: 18,
    });
  }

  if (/!{2,}/.test(subject) || /!{3,}/.test(plainBody)) {
    issues.push({
      code: "excessive_exclamation",
      message: "Multiple exclamation marks look promotional or aggressive.",
      weight: 12,
    });
  }

  if (/\$\s*\d|€\s*\d|£\s*\d|\d+\s*(usd|dollars?|percent|% off)/i.test(combined)) {
    issues.push({
      code: "money_offers",
      message: "Money/discount language increases spam scoring.",
      weight: 10,
    });
  }

  for (const re of SPAM_PHRASES) {
    if (re.test(combined)) {
      issues.push({
        code: "spam_phrase",
        message: "Promotional or spam-trigger wording detected (e.g. FREE, URGENT, ACT NOW).",
        weight: 8,
      });
      break;
    }
  }

  const links = countLinks(`${input.bodyHtml} ${plainBody}`);
  if (links >= 4) {
    issues.push({
      code: "many_links",
      message: `${links} links in the body — high link count hurts deliverability.`,
      weight: 14,
    });
  }

  if (URL_SHORTENERS.test(combined)) {
    issues.push({
      code: "url_shortener",
      message: "URL shorteners (bit.ly, etc.) are often flagged as suspicious.",
      weight: 16,
    });
  }

  if (/see attached|attachment only|open the attached/i.test(plainBody) && plainBody.split(/\s+/).length < 40) {
    issues.push({
      code: "attachment_pitch",
      message: "Body focuses on an attachment with little context — a pattern linked to suspensions.",
      weight: 20,
    });
  }

  if (!input.senderName.trim()) {
    issues.push({ code: "no_sender", message: "Sender name is missing.", weight: 10 });
  }

  const score = Math.min(100, issues.reduce((sum, i) => sum + i.weight, 0));
  const level: ContentRiskLevel = score >= 55 ? "high" : score >= 28 ? "medium" : "low";

  return { score, level, issues };
}

export function heuristicSuggestions(input: {
  subject: string;
  bodyHtml: string;
  issues: HeuristicIssue[];
}): { subject?: string; bodyHtml?: string } {
  const plain = htmlToPlainText(input.bodyHtml).trim();
  const out: { subject?: string; bodyHtml?: string } = {};

  if (input.issues.some((i) => i.code === "subject_all_caps") && input.subject) {
    out.subject = input.subject
      .toLowerCase()
      .replace(/\b\w/g, (c) => c.toUpperCase())
      .replace(/!+/g, ".");
  }

  if (input.issues.some((i) => i.code === "thin_body" || i.code === "attachment_pitch")) {
    const subj = input.subject.trim() || "Message from your sender";
    out.bodyHtml = `<p>Hi {{{name}}},</p>
<p>I hope you're doing well. I'm sharing the information below and have included a file for your review.</p>
<p>If you have any questions, simply reply to this email.</p>
<p>Thank you,<br>${subj.includes("{{{") ? "{{{name}}}" : "The team"}</p>`;
  }

  if (input.issues.some((i) => i.code === "empty_body") && !out.bodyHtml) {
    out.bodyHtml = `<p>Hi {{{name}}},</p>
<p>Please find the details below.</p>
<p>Thank you.</p>`;
  }

  if (!out.bodyHtml && plain.length > 0 && input.issues.some((i) => i.code === "spam_phrase")) {
    out.bodyHtml = input.bodyHtml.replace(/\b(FREE|URGENT|ACT NOW)\b/gi, (m) => m.toLowerCase());
  }

  return out;
}
