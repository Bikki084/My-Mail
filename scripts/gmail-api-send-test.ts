/**
 * Send a small Gmail API test batch (inbox vs spam check).
 *
 * Prerequisites:
 *   npm run gmail:auth
 *
 * Usage:
 *   npm run gmail:send-test -- --csv recipients.csv --limit 40
 *   npm run gmail:send-test -- --emails a@gmail.com,b@gmail.com --subject "Test" --delay 2000
 *
 * CSV: first column with header "email" (or first column = email addresses).
 */
import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import { google } from "googleapis";
import {
  buildSimpleMime,
  encodeGmailRaw,
  assertGmailSendScope,
  readGoogleOAuthEnv,
  readTokenFile,
  sleep,
  writeTokenFile,
} from "./lib/gmail-api-config";

function parseArgs(argv: string[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!;
    if (a.startsWith("--")) {
      const key = a.slice(2);
      const next = argv[i + 1];
      if (next && !next.startsWith("--")) {
        out[key] = next;
        i++;
      } else {
        out[key] = "1";
      }
    }
  }
  return out;
}

function parseCsvEmails(path: string): string[] {
  const raw = readFileSync(path, "utf8");
  const lines = raw.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  if (lines.length === 0) return [];
  const first = lines[0]!.toLowerCase();
  const start = first.includes("email") ? 1 : 0;
  const emails: string[] = [];
  for (let i = start; i < lines.length; i++) {
    const cell = lines[i]!.split(",")[0]?.trim().replace(/^"|"$/g, "") ?? "";
    if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(cell)) emails.push(cell.toLowerCase());
  }
  return emails;
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const limit = Math.max(1, Math.min(500, parseInt(args.limit ?? "40", 10) || 40));
  const delayMs = Math.max(500, parseInt(args.delay ?? "1500", 10) || 1500);
  const subject = args.subject ?? "Bulkfirepro Gmail API deliverability test";
  const html =
    args.body ??
    `<p>Hello,</p><p>This is a small <strong>Gmail API</strong> deliverability test from Bulkfirepro.</p><p>If this landed in spam, the issue is sender reputation/content — not SMTP vs API.</p><p>Please reply if you received this in inbox.</p>`;

  let recipients: string[] = [];
  if (args.csv) {
    const p = resolve(process.cwd(), args.csv);
    if (!existsSync(p)) throw new Error(`CSV not found: ${p}`);
    recipients = parseCsvEmails(p);
  } else if (args.emails) {
    recipients = args.emails
      .split(",")
      .map((e) => e.trim().toLowerCase())
      .filter((e) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e));
  } else {
    throw new Error("Pass --csv path/to/file.csv or --emails a@x.com,b@y.com");
  }

  recipients = [...new Set(recipients)].slice(0, limit);
  if (recipients.length === 0) throw new Error("No valid recipient emails found.");

  const tokenFile = readTokenFile();
  if (!tokenFile?.refresh_token) {
    throw new Error(
      "No Gmail refresh token yet. Run: npm run gmail:auth (sign in once in the browser).",
    );
  }

  assertGmailSendScope(tokenFile.scope ?? process.env.GOOGLE_OAUTH_SCOPE);

  const { clientId, clientSecret, redirectUri } = readGoogleOAuthEnv();
  const oauth2 = new google.auth.OAuth2(clientId, clientSecret, redirectUri);
  oauth2.setCredentials({
    refresh_token: tokenFile.refresh_token,
    access_token: tokenFile.access_token,
    expiry_date: tokenFile.expiry_date,
  });

  oauth2.on("tokens", (tokens) => {
    if (tokens.scope) assertGmailSendScope(tokens.scope);
    writeTokenFile({
      ...tokenFile,
      refresh_token: tokens.refresh_token ?? tokenFile.refresh_token,
      access_token: tokens.access_token ?? tokenFile.access_token,
      expiry_date: tokens.expiry_date ?? tokenFile.expiry_date,
      scope: tokens.scope ?? tokenFile.scope,
    });
  });

  const gmail = google.gmail({ version: "v1", auth: oauth2 });
  if (tokenFile.access_token) {
    try {
      const info = await oauth2.getTokenInfo(tokenFile.access_token);
      assertGmailSendScope(info.scopes?.join(" ") ?? tokenFile.scope);
    } catch {
      /* refresh below will re-issue access token */
    }
  }
  const profile = await gmail.users.getProfile({ userId: "me" });
  const senderEmail = profile.data.emailAddress;
  if (!senderEmail) throw new Error("Could not read sender Gmail address.");

  const from = args.from ?? `Bulkfirepro Test <${senderEmail}>`;

  console.log("\n=== Gmail API send test ===");
  console.log(`Sender:  ${senderEmail}`);
  console.log(`Count:   ${recipients.length} (max ${limit})`);
  console.log(`Delay:   ${delayMs}ms between sends`);
  console.log(`Subject: ${subject}\n`);

  let sent = 0;
  let failed = 0;

  for (let i = 0; i < recipients.length; i++) {
    const to = recipients[i]!;
    const mime = buildSimpleMime({ from, to, subject, html });
    try {
      await gmail.users.messages.send({
        userId: "me",
        requestBody: { raw: encodeGmailRaw(mime) },
      });
      sent++;
      console.log(`  ✓ [${i + 1}/${recipients.length}] ${to}`);
    } catch (e) {
      failed++;
      const msg = e instanceof Error ? e.message : String(e);
      console.log(`  ✗ [${i + 1}/${recipients.length}] ${to} — ${msg.slice(0, 120)}`);
      if (/429|rate|quota|User-rate limit/i.test(msg)) {
        console.log("    Rate limited — waiting 60s...");
        await sleep(60_000);
      }
    }
    if (i < recipients.length - 1) await sleep(delayMs);
  }

  console.log(`\nDone: ${sent} sent, ${failed} failed.`);
  console.log("\nCheck each recipient inbox vs spam folder.");
  console.log("Gmail API uses the same daily limits (~500/day free Gmail) as SMTP.\n");
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
