import { htmlToPlainText } from "@/lib/html-email";
import {
  genuinenessFlagNoreplySender,
  genuinenessMaxGenericPhraseShare,
  genuinenessMinSpecificTokens,
} from "@/lib/anti-spam-config";
import { analyzeContentHeuristics } from "@/lib/content-spam-review/heuristics";
import type { GenuinenessInternalIssue } from "@/lib/content-genuineness/types";

const GENERIC_PHRASES: RegExp[] = [
  /\bi hope this (email|message) finds you well\b/i,
  /\bplease (find|see) (the )?attached\b/i,
  /\bsee (the )?attached (file|document|pdf)\b/i,
  /\bdon'?t miss (out|this)\b/i,
  /\bact now\b/i,
  /\blimited time offer\b/i,
  /\bclick (here|below) (to|and)\b/i,
  /\bas per (our|my) (previous|last)\b/i,
  /\blooking forward to (your|hearing)\b/i,
  /\bfor more information\b/i,
  /\btake action (now|today)\b/i,
  /\bexclusive offer\b/i,
  /\bdear (sir|madam|customer|valued)\b/i,
];

const CLICKBAIT_SUBJECT: RegExp[] = [
  /\byou won'?t believe\b/i,
  /\bshocking\b/i,
  /\bthis one trick\b/i,
  /\bdoctors hate\b/i,
  /\bwhat happened next\b/i,
  /\bmust (see|read|know)\b/i,
  /\bsecret (way|method|trick)\b/i,
];

const STOPWORDS = new Set(
  "a an the and or but if to of in on for with your you we our is are was were be been being this that it as at by from into about than then so not no yes hi hello thanks thank please email message attached attachment document file pdf".split(
    " ",
  ),
);

export function tokenizeMeaningful(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s@._-]/g, " ")
    .split(/\s+/)
    .map((t) => t.trim())
    .filter((t) => t.length >= 3 && !STOPWORDS.has(t));
}

function sentenceList(plain: string): string[] {
  return plain
    .split(/(?<=[.!?])\s+|\n+/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

function jaccard(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 || b.size === 0) return 0;
  let inter = 0;
  for (const x of a) if (b.has(x)) inter += 1;
  const union = a.size + b.size - inter;
  return union === 0 ? 0 : inter / union;
}

export function checkSubjectGenuineness(subject: string): GenuinenessInternalIssue[] {
  const s = subject.trim();
  const issues: GenuinenessInternalIssue[] = [];
  if (!s) {
    issues.push({
      code: "empty_subject",
      category: "subject_quality",
      message: "Subject line is empty.",
      locationHint: "Subject",
      blocks: true,
    });
    return issues;
  }

  const letters = s.replace(/[^a-zA-Z]/g, "");
  if (letters.length >= 6) {
    const upper = letters.replace(/[^A-Z]/g, "").length;
    if (upper / letters.length > 0.55) {
      issues.push({
        code: "subject_caps",
        category: "subject_quality",
        message: "Subject uses excessive capital letters — a common spam signal.",
        locationHint: "Subject",
        blocks: true,
      });
    }
  }

  if (/!{2,}|\?{3,}/.test(s)) {
    issues.push({
      code: "subject_punct",
      category: "subject_quality",
      message: "Subject has excessive punctuation (!! or ???).",
      locationHint: "Subject",
      blocks: true,
    });
  }

  if (/^(re|fwd|fw):\s/i.test(s)) {
    issues.push({
      code: "fake_reply",
      category: "subject_quality",
      message: "Subject starts with Re:/Fwd: — often used as a deceptive spam tactic.",
      locationHint: "Subject",
      blocks: true,
    });
  }

  for (const re of CLICKBAIT_SUBJECT) {
    if (re.test(s)) {
      issues.push({
        code: "clickbait_subject",
        category: "subject_quality",
        message: "Subject uses clickbait phrasing that mail filters commonly reject.",
        locationHint: s.slice(0, 80),
        blocks: true,
      });
      break;
    }
  }

  return issues;
}

export function checkBodyGenuineness(bodyHtml: string): GenuinenessInternalIssue[] {
  const plain = htmlToPlainText(bodyHtml ?? "").trim();
  const issues: GenuinenessInternalIssue[] = [];
  if (!plain) {
    issues.push({
      code: "empty_body",
      category: "body_quality",
      message: "Email body has no readable text.",
      locationHint: "Body",
      blocks: true,
    });
    return issues;
  }

  const sentences = sentenceList(plain);
  for (const sentence of sentences) {
    for (const re of GENERIC_PHRASES) {
      const m = sentence.match(re);
      if (m) {
        issues.push({
          code: "urgency_or_template_line",
          category: "spam_pattern",
          message: `This wording is commonly flagged as spam or templated filler: “${m[0]}”.`,
          locationHint: sentence.slice(0, 120),
          blocks: true,
        });
      }
    }
  }

  const tokens = tokenizeMeaningful(plain);
  const specific = new Set(tokens);
  if (specific.size < genuinenessMinSpecificTokens()) {
    issues.push({
      code: "low_specificity",
      category: "content_too_generic",
      message:
        "Body is too generic — add concrete details (what this is about, who you are, why you’re writing).",
      locationHint: "Body",
      blocks: true,
    });
  }

  let genericHits = 0;
  for (const re of GENERIC_PHRASES) {
    if (re.test(plain)) genericHits += 1;
  }
  const phraseShare = genericHits / Math.max(1, sentences.length);
  if (phraseShare >= genuinenessMaxGenericPhraseShare() && genericHits >= 2) {
    issues.push({
      code: "template_density",
      category: "content_too_generic",
      message: "Body relies heavily on generic template phrases — rewrite in your own words.",
      locationHint: "Body",
      blocks: true,
    });
  }

  // Disjointed keyword stuffing: many short tokens with almost no sentence punctuation
  if (tokens.length >= 40 && sentences.length <= 1 && !/[.!?]/.test(plain)) {
    issues.push({
      code: "keyword_stuffing",
      category: "content_too_generic",
      message: "Body looks like keyword stuffing rather than coherent sentences.",
      locationHint: "Body",
      blocks: true,
    });
  }

  return issues;
}

export function checkSubjectBodyAlignment(
  subject: string,
  bodyHtml: string,
): GenuinenessInternalIssue[] {
  const subj = subject.trim();
  const plain = htmlToPlainText(bodyHtml ?? "").trim();
  const issues: GenuinenessInternalIssue[] = [];
  if (!subj || !plain) return issues;

  const subjTokens = new Set(tokenizeMeaningful(subj));
  const bodyTokens = new Set(tokenizeMeaningful(plain));
  if (subjTokens.size === 0) return issues;

  const overlap = jaccard(subjTokens, bodyTokens);
  const shared = [...subjTokens].filter((t) => bodyTokens.has(t));
  // Bait-and-switch: almost no overlap between subject content words and body
  if (subjTokens.size >= 2 && overlap < 0.05 && shared.length === 0) {
    issues.push({
      code: "subject_body_mismatch",
      category: "subject_body_mismatch",
      message:
        "Subject does not match the body content — avoid misleading or bait-and-switch subject lines.",
      locationHint: "Subject vs body",
      blocks: true,
    });
  }

  return issues;
}

export function checkSenderTrust(senderName: string): GenuinenessInternalIssue[] {
  const issues: GenuinenessInternalIssue[] = [];
  const name = senderName.trim();
  if (!name) {
    issues.push({
      code: "no_sender",
      category: "sender_trust",
      message: "Sender name is missing.",
      locationHint: "Sender name",
      blocks: true,
    });
    return issues;
  }

  if (genuinenessFlagNoreplySender() && /noreply|no-reply|donotreply|do-not-reply/i.test(name)) {
    issues.push({
      code: "noreply_sender",
      category: "sender_trust",
      message:
        "Sender looks like a noreply identity — use a monitored name/address recipients can reply to.",
      locationHint: "Sender name",
      blocks: false, // advisory unless combined with other failures; still surfaces in feedback
    });
  }

  return issues;
}

export function checkHeuristicHardBlocks(input: {
  subject: string;
  bodyHtml: string;
  senderName: string;
}): GenuinenessInternalIssue[] {
  const h = analyzeContentHeuristics(input);
  const issues: GenuinenessInternalIssue[] = [];
  const hardCodes = new Set([
    "hidden_text",
    "url_shortener",
    "fake_reply_subject",
    "spam_phrase",
    "attachment_pitch",
  ]);

  for (const issue of h.issues) {
    if (!hardCodes.has(issue.code) && h.level !== "high") continue;
    if (hardCodes.has(issue.code) || h.level === "high") {
      // Map heuristic to category without exposing weights
      let category: GenuinenessInternalIssue["category"] = "spam_pattern";
      if (issue.code.includes("subject") || issue.code === "fake_reply_subject") {
        category = "subject_quality";
      } else if (issue.code === "thin_body" || issue.code === "attachment_pitch") {
        category = "body_quality";
      }
      issues.push({
        code: `heuristic_${issue.code}`,
        category,
        message: issue.message,
        locationHint: issue.code.includes("subject") ? "Subject" : "Body",
        blocks: hardCodes.has(issue.code) || h.level === "high",
      });
    }
  }

  // Deduplicate by code
  const seen = new Set<string>();
  return issues.filter((i) => {
    if (seen.has(i.code)) return false;
    seen.add(i.code);
    return true;
  });
}

export function jaccardTokenOverlap(a: string, b: string): number {
  return jaccard(new Set(tokenizeMeaningful(a)), new Set(tokenizeMeaningful(b)));
}
