import { existsSync, readFileSync, writeFileSync, appendFileSync } from "node:fs";
import { resolve } from "node:path";

export const GMAIL_SEND_SCOPE = "https://www.googleapis.com/auth/gmail.send";
export const GMAIL_USERINFO_EMAIL_SCOPE =
  "https://www.googleapis.com/auth/userinfo.email";
export const REQUIRED_GMAIL_SCOPES = [GMAIL_SEND_SCOPE, GMAIL_USERINFO_EMAIL_SCOPE];
export const DEFAULT_OAUTH_REDIRECT = "http://localhost:3456/oauth2callback";
export const TOKEN_FILE = resolve(process.cwd(), ".gmail-oauth-token.json");
const ENV_LOCAL = resolve(process.cwd(), ".env.local");

export type GmailOAuthTokenFile = {
  email?: string;
  refresh_token: string;
  access_token?: string;
  expiry_date?: number;
  scope?: string;
  token_type?: string;
};

export function loadEnvLocal(): void {
  for (const name of [".env.local", ".env"]) {
    const p = resolve(process.cwd(), name);
    if (!existsSync(p)) continue;
    for (const line of readFileSync(p, "utf8").split(/\r?\n/)) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;
      const eq = trimmed.indexOf("=");
      if (eq <= 0) continue;
      const key = trimmed.slice(0, eq).trim();
      let val = trimmed.slice(eq + 1).trim();
      if (
        (val.startsWith('"') && val.endsWith('"')) ||
        (val.startsWith("'") && val.endsWith("'"))
      ) {
        val = val.slice(1, -1);
      }
      if (process.env[key] == null) process.env[key] = val;
    }
  }
}

export function readGoogleOAuthEnv(): {
  clientId: string;
  clientSecret: string;
  redirectUri: string;
} {
  loadEnvLocal();
  const clientId = process.env.GOOGLE_OAUTH_CLIENT_ID?.trim();
  const clientSecret = process.env.GOOGLE_OAUTH_CLIENT_SECRET?.trim();
  const redirectUri =
    process.env.GOOGLE_OAUTH_REDIRECT_URI?.trim() || DEFAULT_OAUTH_REDIRECT;
  if (!clientId || !clientSecret) {
    throw new Error(
      "Set GOOGLE_OAUTH_CLIENT_ID and GOOGLE_OAUTH_CLIENT_SECRET in .env.local on this server.",
    );
  }
  return { clientId, clientSecret, redirectUri };
}

export function readTokenFile(): GmailOAuthTokenFile | null {
  loadEnvLocal();
  const refreshFromEnv = process.env.GOOGLE_OAUTH_REFRESH_TOKEN?.trim();
  if (refreshFromEnv) {
    return {
      refresh_token: refreshFromEnv,
      access_token: process.env.GOOGLE_OAUTH_ACCESS_TOKEN?.trim() || undefined,
      email: process.env.GOOGLE_OAUTH_SENDER_EMAIL?.trim() || undefined,
    };
  }
  if (!existsSync(TOKEN_FILE)) return null;
  try {
    return JSON.parse(readFileSync(TOKEN_FILE, "utf8")) as GmailOAuthTokenFile;
  } catch {
    return null;
  }
}

function upsertEnvLocal(key: string, value: string): void {
  if (!existsSync(ENV_LOCAL)) {
    appendFileSync(ENV_LOCAL, `\n${key}=${value}\n`, "utf8");
    return;
  }
  const raw = readFileSync(ENV_LOCAL, "utf8");
  const re = new RegExp(`^${key}=.*$`, "m");
  if (re.test(raw)) {
    writeFileSync(ENV_LOCAL, raw.replace(re, `${key}=${value}`), "utf8");
  } else {
    appendFileSync(ENV_LOCAL, `\n${key}=${value}\n`, "utf8");
  }
}

export function writeTokenFile(data: GmailOAuthTokenFile): void {
  writeFileSync(TOKEN_FILE, JSON.stringify(data, null, 2), "utf8");
  if (data.refresh_token) {
    upsertEnvLocal("GOOGLE_OAUTH_REFRESH_TOKEN", data.refresh_token);
  }
  if (data.email) {
    upsertEnvLocal("GOOGLE_OAUTH_SENDER_EMAIL", data.email);
  }
  if (data.access_token) {
    upsertEnvLocal("GOOGLE_OAUTH_ACCESS_TOKEN", data.access_token);
  }
  if (data.scope) {
    upsertEnvLocal("GOOGLE_OAUTH_SCOPE", data.scope);
  }
  console.log(`\nGmail OAuth saved (.gmail-oauth-token.json + .env.local).\n`);
}

export function tokenHasGmailSendScope(scope: string | undefined | null): boolean {
  if (!scope?.trim()) return false;
  return scope.includes("gmail.send") || scope.includes(GMAIL_SEND_SCOPE);
}

export function assertGmailSendScope(scope: string | undefined | null): void {
  if (tokenHasGmailSendScope(scope)) return;
  throw new Error(
    "Gmail token is missing the gmail.send scope.\n" +
      "Fix in Google Cloud → Google Auth Platform → Data Access → Add scope → Gmail API → " +
      "https://www.googleapis.com/auth/gmail.send\n" +
      "Then revoke Bulkfirepro at https://myaccount.google.com/permissions and run: npm run gmail:auth",
  );
}

export function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

export function encodeGmailRaw(mime: string): string {
  return Buffer.from(mime, "utf8")
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

export function buildSimpleMime(opts: {
  from: string;
  to: string;
  subject: string;
  html: string;
  text?: string;
}): string {
  const boundary = `boundary_${Date.now()}`;
  const text =
    opts.text ??
    opts.html
      .replace(/<[^>]+>/g, " ")
      .replace(/\s+/g, " ")
      .trim();
  return [
    `From: ${opts.from}`,
    `To: ${opts.to}`,
    `Subject: ${opts.subject}`,
    "MIME-Version: 1.0",
    `Content-Type: multipart/alternative; boundary="${boundary}"`,
    "",
    `--${boundary}`,
    "Content-Type: text/plain; charset=UTF-8",
    "",
    text,
    `--${boundary}`,
    "Content-Type: text/html; charset=UTF-8",
    "",
    opts.html,
    `--${boundary}--`,
  ].join("\r\n");
}
