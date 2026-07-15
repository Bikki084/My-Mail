/**
 * AES-256-GCM encryption for SMTP passwords stored in smtp_servers.password_enc.
 *
 * The encryption key is sourced from the SMTP_ENCRYPTION_KEY env var. It must
 * decode to exactly 32 bytes. We accept either base64 or hex so whichever
 * generator the operator prefers (`openssl rand -base64 32`, `openssl rand -hex
 * 32`, or PowerShell's RandomNumberGenerator) works.
 *
 * Output format (encoded as a single string, stored in `password_enc`):
 *   "v1:" + base64(iv || ciphertext || authTag)
 *
 * - v1 prefix lets us rotate schemes later without guessing the format.
 * - 12-byte random IV per encryption (GCM-standard).
 * - GCM authTag (16 bytes) is appended after the ciphertext so the payload is
 *   self-contained.
 */

import "server-only";
import crypto from "node:crypto";

const ALGO = "aes-256-gcm";
const IV_LEN = 12;
const TAG_LEN = 16;
const KEY_LEN = 32;
const SCHEME_V1 = "v1";

let cachedKey: Buffer | null = null;

export class SmtpSecretConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SmtpSecretConfigError";
  }
}

function decodeKeyMaterial(raw: string): Buffer | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;

  // Try base64 first — this is what `openssl rand -base64 32` / PowerShell's
  // `[Convert]::ToBase64String(...)` emit (44 chars incl. padding).
  if (/^[A-Za-z0-9+/=]+$/.test(trimmed)) {
    try {
      const buf = Buffer.from(trimmed, "base64");
      if (buf.length === KEY_LEN) return buf;
    } catch {
      // fall through to hex attempt
    }
  }

  // Fall back to hex (64 chars).
  if (/^[0-9a-fA-F]+$/.test(trimmed) && trimmed.length === KEY_LEN * 2) {
    try {
      const buf = Buffer.from(trimmed, "hex");
      if (buf.length === KEY_LEN) return buf;
    } catch {
      // ignore
    }
  }

  return null;
}

export function getSmtpEncryptionKey(): Buffer {
  if (cachedKey) return cachedKey;
  const raw = process.env.SMTP_ENCRYPTION_KEY;
  if (!raw) {
    throw new SmtpSecretConfigError(
      "SMTP_ENCRYPTION_KEY is not set. Generate one and add to .env.local: " +
        "`openssl rand -base64 32` (or in PowerShell: " +
        "`[Convert]::ToBase64String([System.Security.Cryptography.RandomNumberGenerator]::GetBytes(32))`).",
    );
  }
  const key = decodeKeyMaterial(raw);
  if (!key) {
    throw new SmtpSecretConfigError(
      "SMTP_ENCRYPTION_KEY must decode to exactly 32 bytes. Provide a base64 (44 char) " +
        "or hex (64 char) string. Generate a fresh one with `openssl rand -base64 32`.",
    );
  }
  cachedKey = key;
  return key;
}

export function encryptSmtpPassword(plaintext: string): string {
  if (typeof plaintext !== "string") {
    throw new TypeError("plaintext must be a string");
  }
  const key = getSmtpEncryptionKey();
  const iv = crypto.randomBytes(IV_LEN);
  const cipher = crypto.createCipheriv(ALGO, key, iv);
  const enc = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  const payload = Buffer.concat([iv, enc, tag]);
  return `${SCHEME_V1}:${payload.toString("base64")}`;
}

export function decryptSmtpPassword(encoded: string): string {
  if (typeof encoded !== "string" || !encoded.startsWith(`${SCHEME_V1}:`)) {
    throw new Error("Unsupported SMTP password ciphertext format.");
  }
  const key = getSmtpEncryptionKey();
  const payload = Buffer.from(encoded.slice(SCHEME_V1.length + 1), "base64");
  if (payload.length < IV_LEN + TAG_LEN + 1) {
    throw new Error("SMTP password ciphertext is truncated.");
  }
  const iv = payload.subarray(0, IV_LEN);
  const tag = payload.subarray(payload.length - TAG_LEN);
  const ciphertext = payload.subarray(IV_LEN, payload.length - TAG_LEN);
  const decipher = crypto.createDecipheriv(ALGO, key, iv);
  decipher.setAuthTag(tag);
  const dec = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
  return dec.toString("utf8");
}

/** Sanity helper for tests / diagnostics. Never log the returned value. */
export function isValidEncryptionKeyConfigured(): boolean {
  try {
    getSmtpEncryptionKey();
    return true;
  } catch {
    return false;
  }
}
