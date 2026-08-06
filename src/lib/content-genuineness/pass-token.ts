import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import { genuinenessPassTokenTtlMinutes } from "@/lib/anti-spam-config";

function signingSecret(): string {
  const key =
    process.env.GENUINENESS_PASS_TOKEN_SECRET?.trim() ||
    process.env.SMTP_ENCRYPTION_KEY?.trim() ||
    "";
  if (key) return key;
  // Dev fallback — production should set SMTP_ENCRYPTION_KEY or GENUINENESS_PASS_TOKEN_SECRET.
  return "dev-genuineness-pass-token-secret";
}

export function messageContentFingerprint(input: {
  subject: string;
  bodyHtml: string;
  senderName: string;
  attachmentFingerprint?: string;
}): string {
  const raw = [
    input.subject.trim(),
    input.senderName.trim(),
    input.bodyHtml.trim(),
    input.attachmentFingerprint ?? "",
  ].join("\n");
  return createHash("sha256").update(raw).digest("hex").slice(0, 40);
}

export function attachmentListFingerprint(
  parts: { filename: string; contentBase64?: string; htmlText?: string }[],
): string {
  if (!parts.length) return "";
  const h = createHash("sha256");
  for (const p of parts) {
    h.update((p.filename || "attachment").trim().toLowerCase());
    h.update("\0");
    const b64 = (p.contentBase64 ?? "").trim();
    if (b64) h.update(b64.slice(0, 64_000));
    const html = (p.htmlText ?? "").trim();
    if (html) h.update(html.slice(0, 64_000));
    h.update("\n");
  }
  return h.digest("hex").slice(0, 24);
}

/**
 * Issue a short-lived pass token bound to user + content fingerprint.
 * Format: v1.<fingerprint>.<expMs>.<hmac>
 */
export function issueGenuinenessPassToken(input: {
  userId: string;
  fingerprint: string;
}): string {
  const exp = Date.now() + genuinenessPassTokenTtlMinutes() * 60_000;
  const payload = `v1.${input.fingerprint}.${exp}.${input.userId}`;
  const sig = createHmac("sha256", signingSecret()).update(payload).digest("hex").slice(0, 32);
  return `${payload}.${sig}`;
}

export type PassTokenVerifyResult =
  | { ok: true; fingerprint: string }
  | { ok: false; reason: string };

export function verifyGenuinenessPassToken(input: {
  token: string;
  userId: string;
  fingerprint: string;
}): PassTokenVerifyResult {
  const parts = input.token.trim().split(".");
  if (parts.length !== 5 || parts[0] !== "v1") {
    return { ok: false, reason: "Invalid verification token." };
  }
  const [, fp, expRaw, userId, sig] = parts as [string, string, string, string, string];
  const exp = parseInt(expRaw, 10);
  if (!Number.isFinite(exp) || exp < Date.now()) {
    return { ok: false, reason: "Content verification expired — run the check again." };
  }
  if (userId !== input.userId) {
    return { ok: false, reason: "Content verification does not match this account." };
  }
  if (fp !== input.fingerprint) {
    return { ok: false, reason: "Message changed since verification — re-check before sending." };
  }
  const payload = `v1.${fp}.${expRaw}.${userId}`;
  const expected = createHmac("sha256", signingSecret()).update(payload).digest("hex").slice(0, 32);
  try {
    const a = Buffer.from(sig, "utf8");
    const b = Buffer.from(expected, "utf8");
    if (a.length !== b.length || !timingSafeEqual(a, b)) {
      return { ok: false, reason: "Invalid verification token." };
    }
  } catch {
    return { ok: false, reason: "Invalid verification token." };
  }
  return { ok: true, fingerprint: fp };
}
