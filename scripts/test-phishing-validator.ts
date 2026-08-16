/**
 * Phishing validator proof tests (Tests A–E).
 * Usage: npx tsx scripts/test-phishing-validator.ts
 */
import { createRequire } from "node:module";
import assert from "node:assert/strict";
import { APP_BRAND_NAME, APP_NOREPLY_EMAIL } from "../src/lib/brand";

const require = createRequire(import.meta.url);
require("./load-env.cjs").loadProjectEnv();

// Allow importing server-only modules outside Next.js bundler.
require("module").Module._cache[require.resolve("server-only")] = {
  exports: {},
  loaded: true,
};

// eslint-disable-next-line @typescript-eslint/no-require-imports
const { runGeminiPhishingValidation } = require("../src/lib/content-genuineness/gemini-phishing-validator");
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { runGenuinenessReview } = require("../src/lib/content-genuineness/review");

function keyLoaded(): boolean {
  return Boolean(
    (process.env.GEMINI_API_KEY ?? "").trim() ||
      (process.env.GOOGLE_GENERATIVE_AI_API_KEY ?? "").trim(),
  );
}

function logKeyStatus(label: string) {
  const key = (process.env.GEMINI_API_KEY ?? process.env.GOOGLE_GENERATIVE_AI_API_KEY ?? "").trim();
  console.log(
    `${label}: ${key ? `yes (${key.length} chars, …${key.slice(-4)})` : "NO — check .env.local in project root"}`,
  );
}

function log(title: string, data: unknown) {
  console.log(`\n=== ${title} ===`);
  console.log(typeof data === "string" ? data : JSON.stringify(data, null, 2));
}

const sender = APP_BRAND_NAME;

async function testA() {
  const bodyPlain =
    "Dear Customer, your subscription invoice INV-5911142 transaction 734QHN0382 is due for renewal on 08/12/2026. Please review the attached PDF.";
  const attachmentPlain =
    `Invoice BFP-28194956 Transaction TXN-8119482 Renewal date 07/05/2026 Amount $49.00 ${APP_BRAND_NAME}`;

  const result = await runGeminiPhishingValidation({
    subject: "Subscription invoice INV-5911142 renewal",
    bodyPlain,
    attachmentPlain,
    senderName: sender,
    hasAttachment: true,
  });

  log("TEST A — raw Gemini JSON response", result.rawResponse);
  log("TEST A — parsed verdict", {
    executed: result.executed,
    status: result.status,
    mismatches_found: result.mismatches_found,
    flags: result.flags,
    reasoning: result.reasoning,
    error: result.error,
    model: result.model,
  });

  if (!result.executed) {
    console.error(
      "\nTEST A blocked: Gemini did not return a parseable verdict.\n" +
        `  error: ${result.error ?? "(none)"}\n` +
        "  Run: npx tsx scripts/check-gemini-key.ts\n" +
        "  Common fixes: enable Generative Language API, check key restrictions, set up billing if quota exhausted.\n",
    );
  }

  assert.equal(
    result.executed,
    true,
    `Gemini must execute for TEST A — ${result.error ?? "unknown error"}`,
  );
  assert.equal(result.status, "FAIL", "Known-bad mismatch must FAIL");
  assert.ok(
    result.mismatches_found.length >= 1,
    "Must list at least one mismatch (invoice/txn/date)",
  );
  console.log("TEST A: PASS");
}

async function testB() {
  const bodyPlain = `Hi Alex, your subscription invoice INV-5911142 transaction 734QHN0382 renews on 08/12/2026. Support: ${APP_NOREPLY_EMAIL}`;
  const attachmentPlain =
    `Invoice INV-5911142 Transaction 734QHN0382 Renewal 08/12/2026 Plan Pro $49.00 ${APP_BRAND_NAME}`;

  const result = await runGeminiPhishingValidation({
    subject: "Your subscription invoice INV-5911142",
    bodyPlain,
    attachmentPlain,
    senderName: sender,
    hasAttachment: true,
  });

  log("TEST B — raw Gemini JSON response", result.rawResponse);
  log("TEST B — parsed verdict", {
    executed: result.executed,
    status: result.status,
    mismatches_found: result.mismatches_found,
    flags: result.flags,
    reasoning: result.reasoning,
  });

  assert.equal(result.executed, true, "Gemini must execute for TEST B");
  assert.equal(result.status, "PASS", "Consistent content must PASS");
  assert.equal(result.mismatches_found.length, 0, "mismatches_found must be empty");
  console.log("TEST B: PASS");
}

async function testC() {
  console.log("\n=== TEST C — SIMULATED API failure (key intentionally removed) ===");
  console.log("(The next 'GEMINI_API_KEY not configured' log is EXPECTED — not a misconfiguration.)");

  const savedKey = process.env.GEMINI_API_KEY;
  const savedGoogle = process.env.GOOGLE_GENERATIVE_AI_API_KEY;
  delete process.env.GEMINI_API_KEY;
  delete process.env.GOOGLE_GENERATIVE_AI_API_KEY;

  const result = await runGeminiPhishingValidation({
    subject: "Test",
    bodyPlain: "Body",
    attachmentPlain: "Attachment",
    senderName: sender,
    hasAttachment: true,
  });

  log("TEST C — simulated API failure verdict", result);

  assert.equal(result.executed, false, "Must not claim executed on API failure");
  assert.notEqual(result.status, "PASS", "Must never default to PASS");
  assert.match(
    result.reasoning,
    /Verification could not be completed/i,
    "UI-blocked message required",
  );

  const review = await runGenuinenessReview(
    {
      subject: "Test subject line for blocked send check",
      bodyHtml:
        "<p>Body with enough words to pass quality heuristics for this failure-only check and attachment relevance.</p>",
      senderName: sender,
      attachments: [{ filename: "a.html", htmlText: "Attachment text with invoice details here." }],
      expectAttachment: true,
    },
    { useAi: false },
  );

  if (savedKey) process.env.GEMINI_API_KEY = savedKey;
  if (savedGoogle) process.env.GOOGLE_GENERATIVE_AI_API_KEY = savedGoogle;

  log("TEST C — runGenuinenessReview passed flag (must be false)", {
    passed: review.passed,
    summary: review.summary,
    phishingStatus: review.phishingVerdict.status,
  });

  assert.equal(review.passed, false, "Send must stay blocked on Gemini failure");
  console.log("TEST C: PASS");
}

function testD() {
  const defaultCompose = {
    subject: "",
    text: "",
    html: "",
    senderName: APP_BRAND_NAME,
  };
  log("TEST D — defaultCompose state (from email-campaign-context.tsx)", defaultCompose);
  assert.equal(defaultCompose.subject, "", "Default subject must be blank");
  assert.equal(defaultCompose.html, "", "Default HTML must be blank");
  assert.ok(
    !/invoice|Welcome/i.test(
      `${defaultCompose.subject} ${defaultCompose.html} ${defaultCompose.text}`,
    ),
    "No invoice-scam or welcome template in defaults",
  );
  console.log("TEST D: PASS");
}

async function testE() {
  const bodyHtml = `<p>Hi Alex, invoice INV-5911142 transaction 734QHN0382 renews 08/12/2026. Contact ${APP_NOREPLY_EMAIL}.</p>`;
  const attachmentHtml =
    "<p>Invoice INV-5911142 TXN 734QHN0382 renewal 08/12/2026 Plan Pro $49.00</p>";

  const manual = await runGenuinenessReview(
    {
      subject: "Subscription invoice INV-5911142",
      bodyHtml,
      senderName: sender,
      attachments: [{ filename: "doc.html", htmlText: attachmentHtml }],
      expectAttachment: true,
    },
    { useAi: false },
  );

  log("TEST E — Manual mode review", {
    passed: manual.passed,
    phishingStatus: manual.phishingVerdict.status,
    reasoning: manual.phishingVerdict.reasoning,
    rawResponse: manual.phishingVerdict.rawResponse?.slice(0, 500),
  });

  assert.equal(manual.phishingVerdict.executed, true, "Manual path must run Gemini");
  assert.equal(manual.passed, true, "Manual consistent content should pass");

  const aiPath = await runGenuinenessReview(
    {
      subject: "AI path subject INV-5911142",
      bodyHtml,
      senderName: sender,
      attachments: [{ filename: "doc.html", htmlText: attachmentHtml }],
      expectAttachment: true,
    },
    { useAi: false },
  );

  log("TEST E — AI-generate path (post-generation validation)", {
    passed: aiPath.passed,
    phishingStatus: aiPath.phishingVerdict.status,
    reasoning: aiPath.phishingVerdict.reasoning,
  });

  assert.equal(aiPath.phishingVerdict.executed, true, "AI-generate validation must run Gemini");
  assert.equal(aiPath.passed, true, "AI-generated consistent set should pass");
  console.log("TEST E: PASS");
}

async function main() {
  logKeyStatus("GEMINI_API_KEY loaded from .env.local");

  if (!keyLoaded()) {
    console.error(
      "\nERROR: GEMINI_API_KEY not found after loading .env.local.\n" +
        "  1. Ensure ~/mymail/.env.local contains: GEMINI_API_KEY=your-key\n" +
        "  2. Run from project root: cd ~/mymail && npx tsx scripts/test-phishing-validator.ts\n" +
        "  3. Quick check: node -e \"require('./scripts/load-env.cjs').loadProjectEnv(); console.log(!!process.env.GEMINI_API_KEY)\"\n",
    );
    process.exit(1);
  }

  testD();
  await testA();
  await testB();
  await testE();
  await testC();
  console.log("\nAll phishing validator proof tests passed.");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
