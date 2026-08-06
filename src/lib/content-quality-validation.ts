import { htmlToPlainText } from "@/lib/html-email";
import { contentMinTextCharsPerAttachmentKb, contentMinWordCount } from "@/lib/anti-spam-config";

export type ContentQualityFailureCode =
  | "body_too_short"
  | "attachment_text_ratio"
  | "placeholder_body"
  | "empty_body";

export type ContentQualityResult =
  | { ok: true; wordCount: number; textLength: number }
  | {
      ok: false;
      code: ContentQualityFailureCode;
      message: string;
      wordCount?: number;
      minWords?: number;
      textLength?: number;
      attachmentBytes?: number;
    };

const PLACEHOLDER_PATTERNS: RegExp[] = [
  /^test\.?$/i,
  /^hi\.?$/i,
  /^hello\.?$/i,
  /^hey\.?$/i,
  /^\.{2,}$/,
  /^-+$/,
  /^_+$/,
  /^x+$/i,
  /^asdf+$/i,
  /^lorem\s+ipsum$/i,
  /^placeholder$/i,
  /^sample$/i,
  /^todo$/i,
  /^testing\.?$/i,
  /^please\s+see\s+attached\.?$/i,
  /^see\s+attached\.?$/i,
];

/** Count words in plain text (whitespace-separated tokens). */
export function countMeaningfulWords(plainText: string): number {
  const trimmed = plainText.trim();
  if (!trimmed) return 0;
  return trimmed.split(/\s+/).filter((w) => w.length > 0).length;
}

function isRepeatedSingleCharacter(text: string): boolean {
  const compact = text.replace(/\s+/g, "");
  if (compact.length < 4) return false;
  const first = compact[0]!.toLowerCase();
  return compact.split("").every((c) => c.toLowerCase() === first);
}

function isMostlyRepeatedWord(text: string): boolean {
  const words = text
    .trim()
    .toLowerCase()
    .split(/\s+/)
    .filter((w) => w.length > 0);
  if (words.length < 4) return false;
  const freq = new Map<string, number>();
  for (const w of words) {
    freq.set(w, (freq.get(w) ?? 0) + 1);
  }
  const max = Math.max(...freq.values());
  return max / words.length >= 0.75;
}

/** Detect placeholder / gaming content used to pass minimum-length checks. */
export function isBoilerplateOrPlaceholder(plainText: string): boolean {
  const trimmed = plainText.trim();
  if (!trimmed) return true;
  const normalized = trimmed.replace(/\s+/g, " ").toLowerCase();
  if (PLACEHOLDER_PATTERNS.some((re) => re.test(normalized))) return true;
  if (isRepeatedSingleCharacter(trimmed)) return true;
  if (isMostlyRepeatedWord(trimmed)) return true;
  return false;
}

export function validateContentQuality(input: {
  bodyHtml: string;
  attachmentTotalBytes?: number;
  minWords?: number;
  minTextCharsPerAttachmentKb?: number;
}): ContentQualityResult {
  const plain = htmlToPlainText(input.bodyHtml ?? "").trim();
  const wordCount = countMeaningfulWords(plain);
  const textLength = plain.length;
  const minWords = input.minWords ?? contentMinWordCount();
  const minRatio = input.minTextCharsPerAttachmentKb ?? contentMinTextCharsPerAttachmentKb();
  const attachmentBytes = Math.max(0, input.attachmentTotalBytes ?? 0);

  if (textLength === 0) {
    return {
      ok: false,
      code: "empty_body",
      message: "Email body must contain readable text (not empty HTML).",
      wordCount: 0,
      minWords,
    };
  }

  if (isBoilerplateOrPlaceholder(plain)) {
    return {
      ok: false,
      code: "placeholder_body",
      message:
        "Email body looks like placeholder or filler text (e.g. “test”, “hi”, repeated characters). Add a real message for recipients.",
      wordCount,
      minWords,
    };
  }

  if (wordCount < minWords) {
    return {
      ok: false,
      code: "body_too_short",
      message: `Body too short: ${wordCount} words, minimum required is ${minWords}. Add more descriptive content before sending.`,
      wordCount,
      minWords,
    };
  }

  if (attachmentBytes > 0 && minRatio > 0) {
    const attachmentKb = attachmentBytes / 1024;
    const requiredChars = attachmentKb * minRatio;
    if (textLength < requiredChars) {
      return {
        ok: false,
        code: "attachment_text_ratio",
        message: `Attachment-to-text ratio too low: body has ${textLength} characters but attachments total ${(attachmentBytes / (1024 * 1024)).toFixed(2)} MB. Add more descriptive body content so the email is not attachment-only.`,
        wordCount,
        textLength,
        attachmentBytes,
      };
    }
  }

  return { ok: true, wordCount, textLength };
}
