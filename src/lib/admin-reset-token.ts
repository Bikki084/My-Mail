import { createHash, randomBytes, timingSafeEqual } from "node:crypto";

const TOKEN_BYTES = 32;

export function generateAdminResetSecret(): string {
  return randomBytes(TOKEN_BYTES).toString("base64url");
}

export function hashAdminResetToken(secret: string): string {
  return createHash("sha256").update(secret, "utf8").digest("hex");
}

/** Constant-time compare of two equal-length hex strings (64 chars for SHA-256). */
export function equalTokenHashes(a: string | null | undefined, b: string): boolean {
  if (!a || a.length !== b.length) return false;
  try {
    return timingSafeEqual(Buffer.from(a, "hex"), Buffer.from(b, "hex"));
  } catch {
    return false;
  }
}

export function adminResetTokenExpiresAt(from: Date = new Date()): string {
  return new Date(from.getTime() + 10 * 60 * 1000).toISOString();
}
