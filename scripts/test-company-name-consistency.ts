/**
 * Company-name lock proof (TEST B generate+verify, TEST C wrong spelling still fails).
 * Usage: npx tsx scripts/test-company-name-consistency.ts
 */
import { createRequire } from "node:module";
import assert from "node:assert/strict";
import {
  APP_BRAND_NAME,
  APP_BRAND_WRONG_LETTER_ORDER,
  applyCanonicalBrandName,
} from "../src/lib/brand";
import { assertFinalPersistedConsistency } from "../src/lib/content-genuineness/consistency";
import { buildPreviewRecipientRow } from "../src/lib/content-genuineness/preview-recipient";

const require = createRequire(import.meta.url);
require("./load-env.cjs").loadProjectEnv();
require("module").Module._cache[require.resolve("server-only")] = {
  exports: {},
  loaded: true,
};

const { generateCampaignFromBrief } = require("../src/lib/content-genuineness/ai-generate-campaign");

const wrong = APP_BRAND_WRONG_LETTER_ORDER;
const preview = buildPreviewRecipientRow("client@example.com");

function log(title: string, data: unknown) {
  console.log(`\n=== ${title} ===`);
  console.log(typeof data === "string" ? data : JSON.stringify(data, null, 2));
}

function testC() {
  const bad = assertFinalPersistedConsistency({
    subject: `Update regarding your ${wrong} account`,
    bodyHtml: `<p>Hi {{{name}}}, this is a status update from ${wrong}. No payment is due. Support listed here.</p>`,
    attachmentHtml: `<p>${wrong} status summary. Mailbox reachable. Support listed here.</p>`,
    senderName: APP_BRAND_NAME,
    previewRecipient: preview,
  });
  log("TEST C — wrong spelling draft (must FAIL)", bad);
  assert.equal(bad.ok, false, "Wrong letter-order company name must fail");
  if (!bad.ok) {
    assert.ok(bad.mismatches.some((m) => m.field === "company_name"));
  }
  console.log("TEST C: PASS (mismatch still blocked)");
}

async function testB() {
  if (!process.env.GEMINI_API_KEY && !process.env.GOOGLE_GENERATIVE_AI_API_KEY) {
    console.error("TEST B skipped: GEMINI_API_KEY not loaded.");
    process.exit(2);
  }

  const result = await generateCampaignFromBrief({
    brief: "write a phishing and spam free simple mail for a connectivity test",
    senderName: APP_BRAND_NAME,
    mergeTags: ["name", "email"],
  });
  log("TEST B — generate+verify raw result", result);
  assert.equal(result.ok, true, "Must generate");
  const blob = `${result.subject}\n${result.bodyHtml}\n${result.attachmentHtml}`;
  const normalized = applyCanonicalBrandName(blob, APP_BRAND_NAME);
  assert.equal(normalized, blob, "Output should already use canonical brand casing");
  assert.ok(
    new RegExp(`\\b${APP_BRAND_NAME}\\b`, "i").test(blob),
    `Generated content must contain ${APP_BRAND_NAME}`,
  );
  assert.equal(result.canonical?.company_name, APP_BRAND_NAME, "canonical.company_name must be APP_BRAND_NAME");
  assert.equal(result.passedVerification, true, "Verifier must PASS");

  const local = assertFinalPersistedConsistency({
    subject: result.subject,
    bodyHtml: result.bodyHtml,
    attachmentHtml: result.attachmentHtml,
    senderName: APP_BRAND_NAME,
    previewRecipient: preview,
  });
  log("TEST B — local company_name consistency", local);
  assert.equal(local.ok, true, "Local consistency must pass after brand lock");
  console.log("TEST B: PASS");
}

async function main() {
  console.log(`Canonical brand: ${APP_BRAND_NAME}`);
  console.log(`Wrong letter-order spelling under test: ${wrong}`);
  testC();
  await testB();
  console.log("\nCompany-name proof finished.");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
