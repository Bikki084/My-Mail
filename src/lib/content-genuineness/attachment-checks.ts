import { genuinenessAttachmentRelevanceMin } from "@/lib/anti-spam-config";
import { jaccardTokenOverlap, tokenizeMeaningful } from "@/lib/content-genuineness/checks";
import type { GenuinenessInternalIssue } from "@/lib/content-genuineness/types";

export function checkAttachmentContent(
  perFile: { filename: string; text: string }[],
): GenuinenessInternalIssue[] {
  const issues: GenuinenessInternalIssue[] = [];
  for (const file of perFile) {
    const tokens = tokenizeMeaningful(file.text);
    if (tokens.length < 5) {
      issues.push({
        code: "attachment_unreadable",
        category: "attachment_content",
        message: `Attachment “${file.filename}” has little readable text — ensure the document is legible and not an empty or image-only PDF.`,
        locationHint: file.filename,
        blocks: true,
      });
      continue;
    }

    if (
      /\bact now\b|\bfree money\b|\bclick here\b|\bverify your account\b|\bwinner\b|\bviagra\b|\bcasino\b/i.test(
        file.text,
      )
    ) {
      issues.push({
        code: "attachment_spam_text",
        category: "attachment_content",
        message: `Attachment “${file.filename}” contains wording commonly associated with spam.`,
        locationHint: file.filename,
        blocks: true,
      });
    }
  }
  return issues;
}

export function checkBodyAttachmentRelevance(
  bodyPlain: string,
  attachmentCombined: string,
): GenuinenessInternalIssue[] {
  const issues: GenuinenessInternalIssue[] = [];
  if (!attachmentCombined.trim()) return issues;
  if (!bodyPlain.trim()) return issues;

  const min = genuinenessAttachmentRelevanceMin();
  if (min <= 0) return issues;

  const overlap = jaccardTokenOverlap(bodyPlain, attachmentCombined);
  const bodyTokens = tokenizeMeaningful(bodyPlain);
  const attTokens = tokenizeMeaningful(attachmentCombined);

  if (bodyTokens.length < 8 || attTokens.length < 8) return issues;

  if (overlap < min) {
    issues.push({
      code: "attachment_body_mismatch",
      category: "attachment_mismatch",
      message:
        "Attachment appears unrelated to the message body — a common phishing/spam pattern. Align the email text with what the document actually contains.",
      locationHint: "Body vs attachment",
      blocks: true,
    });
  }

  return issues;
}
