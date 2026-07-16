/**
 * Exchange an OAuth `code` from the browser redirect URL when localhost:3456
 * was not listening (connection refused). Copy the full `code=` value from the URL bar.
 *
 *   npm run gmail:exchange-code -- --code "4/0Adk..."
 */
import { google } from "googleapis";
import {
  assertGmailSendScope,
  readGoogleOAuthEnv,
  writeTokenFile,
  type GmailOAuthTokenFile,
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
      }
    }
  }
  return out;
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  let code = args.code?.trim();
  if (!code) {
    throw new Error(
      'Pass --code "PASTE_FROM_URL" (the value after code= in the localhost redirect URL).',
    );
  }
  code = decodeURIComponent(code);

  const { clientId, clientSecret, redirectUri } = readGoogleOAuthEnv();
  const oauth2 = new google.auth.OAuth2(clientId, clientSecret, redirectUri);

  const { tokens } = await oauth2.getToken(code);
  oauth2.setCredentials(tokens);

  assertGmailSendScope(tokens.scope);
  if (tokens.access_token) {
    const info = await oauth2.getTokenInfo(tokens.access_token);
    assertGmailSendScope(info.scopes?.join(" ") ?? tokens.scope);
  }

  const oauth2Api = google.oauth2({ version: "v2", auth: oauth2 });
  const profile = await oauth2Api.userinfo.get();
  const email = profile.data.email ?? undefined;

  if (!tokens.refresh_token) {
    throw new Error(
      "No refresh_token in response. Run npm run gmail:auth again with the terminal listening first.",
    );
  }

  const payload: GmailOAuthTokenFile = {
    email,
    refresh_token: tokens.refresh_token,
    access_token: tokens.access_token ?? undefined,
    expiry_date: tokens.expiry_date ?? undefined,
    scope: tokens.scope ?? undefined,
    token_type: tokens.token_type ?? undefined,
  };

  writeTokenFile(payload);
  console.log(`Granted scopes: ${payload.scope ?? "(none)"}`);
  console.log(`Connected Gmail sender: ${email ?? "(unknown)"}`);
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
