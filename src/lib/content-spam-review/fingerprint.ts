import { createHash } from "node:crypto";

export function contentReviewFingerprint(input: {
  subject: string;
  bodyHtml: string;
  senderName: string;
}): string {
  const raw = `${input.subject.trim()}\n${input.senderName.trim()}\n${input.bodyHtml.trim()}`;
  return createHash("sha256").update(raw).digest("hex").slice(0, 32);
}
