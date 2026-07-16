/**
 * One-time Gmail API OAuth setup (testing).
 *
 * 1. Enable Gmail API in Google Cloud Console.
 * 2. OAuth client → Web application → add redirect URI:
 *      http://localhost:3456/oauth2callback
 * 3. Set GOOGLE_OAUTH_CLIENT_ID + GOOGLE_OAUTH_CLIENT_SECRET in .env.local
 * 4. Run: npm run gmail:auth
 *
 * Sign in with the Gmail account you want to send from (e.g. bikkishaw084@gmail.com).
 */
import http from "node:http";
import { google } from "googleapis";
import {
  GMAIL_SEND_SCOPE,
  GMAIL_USERINFO_EMAIL_SCOPE,
  assertGmailSendScope,
  readGoogleOAuthEnv,
  writeTokenFile,
  type GmailOAuthTokenFile,
} from "./lib/gmail-api-config";

async function main(): Promise<void> {
  const { clientId, clientSecret, redirectUri } = readGoogleOAuthEnv();
  const oauth2 = new google.auth.OAuth2(clientId, clientSecret, redirectUri);

  const authUrl = oauth2.generateAuthUrl({
    access_type: "offline",
    prompt: "consent",
    scope: [GMAIL_SEND_SCOPE, GMAIL_USERINFO_EMAIL_SCOPE],
  });

  console.log("\n=== Gmail API OAuth (test) ===\n");
  console.log("1) Open this URL in your browser and sign in with the sender Gmail account:\n");
  console.log(authUrl);
  console.log("\n2) Waiting for redirect to", redirectUri, "...\n");

  const code = await waitForOAuthCode(redirectUri);
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
    console.warn(
      "WARN: No refresh_token returned. Revoke app access at https://myaccount.google.com/permissions and run again with prompt=consent.",
    );
  }

  const payload: GmailOAuthTokenFile = {
    email,
    refresh_token: tokens.refresh_token ?? "",
    access_token: tokens.access_token ?? undefined,
    expiry_date: tokens.expiry_date ?? undefined,
    scope: tokens.scope ?? undefined,
    token_type: tokens.token_type ?? undefined,
  };

  if (!payload.refresh_token) {
    throw new Error(
      "Missing refresh_token. Remove Bulkfirepro from Google Account permissions and re-run npm run gmail:auth.",
    );
  }

  writeTokenFile(payload);
  console.log(`Granted scopes: ${payload.scope ?? "(none)"}`);
  console.log(`Connected Gmail sender: ${email ?? "(unknown)"}`);
  console.log("Next: npm run gmail:send-test -- --csv your-recipients.csv --limit 40\n");
}

function waitForOAuthCode(redirectUri: string): Promise<string> {
  const expected = new URL(redirectUri);
  const port = expected.port ? Number(expected.port) : expected.protocol === "https:" ? 443 : 80;

  return new Promise((resolve, reject) => {
    const server = http.createServer((req, res) => {
      try {
        const url = new URL(req.url ?? "/", `http://127.0.0.1:${port}`);
        if (url.pathname !== expected.pathname) {
          res.writeHead(404);
          res.end("Not found");
          return;
        }
        const err = url.searchParams.get("error");
        if (err) {
          res.writeHead(400);
          res.end(`OAuth error: ${err}`);
          server.close();
          reject(new Error(`OAuth error: ${err}`));
          return;
        }
        const code = url.searchParams.get("code");
        if (!code) {
          res.writeHead(400);
          res.end("Missing code");
          return;
        }
        res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
        res.end(
          "<html><body><h2>Gmail connected</h2><p>You can close this tab and return to the terminal.</p></body></html>",
        );
        server.close();
        resolve(code);
      } catch (e) {
        server.close();
        reject(e);
      }
    });

    server.on("error", reject);
    server.listen(port, "127.0.0.1", () => {
      console.log(`Listening on http://127.0.0.1:${port}${expected.pathname}`);
    });

    setTimeout(() => {
      server.close();
      reject(new Error("OAuth timed out after 5 minutes."));
    }, 5 * 60 * 1000);
  });
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
