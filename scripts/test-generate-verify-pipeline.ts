/**
 * Generate+verify pipeline proof (Tests A–D).
 * Usage: npx tsx scripts/test-generate-verify-pipeline.ts
 */
import { createRequire } from "node:module";
import assert from "node:assert/strict";

const require = createRequire(import.meta.url);
require("./load-env.cjs").loadProjectEnv();
require("module").Module._cache[require.resolve("server-only")] = {
  exports: {},
  loaded: true,
};

const { generateCampaignFromBrief } = require("../src/lib/content-genuineness/ai-generate-campaign");
const { textHasFinancialFields } = require("../src/lib/content-genuineness/content-type");

function log(title: string, data: unknown) {
  console.log(`\n=== ${title} ===`);
  console.log(typeof data === "string" ? data : JSON.stringify(data, null, 2));
}

async function runPrompt(label: string, brief: string) {
  const result = await generateCampaignFromBrief({
    brief,
    senderName: "BulkProFire",
    mergeTags: ["name", "email"],
  });
  log(label, result);
  return result;
}

async function main() {
  if (!process.env.GEMINI_API_KEY && !process.env.GOOGLE_GENERATIVE_AI_API_KEY) {
    console.error("GEMINI_API_KEY not loaded — cannot run live pipeline tests.");
    process.exit(1);
  }

  const a = await runPrompt(
    "TEST A — connectivity test",
    "write a phishing and spam free simple mail for a connectivity test",
  );
  assert.equal(a.ok, true, "TEST A must generate");
  const aBlob = `${a.subject}\n${a.bodyHtml}\n${a.attachmentHtml}`;
  assert.equal(a.contentType, "connectivity_test", "TEST A content_type");
  assert.equal(textHasFinancialFields(aBlob), false, "TEST A must not contain invoice/txn fields");
  assert.equal(a.passedVerification, true, "TEST A must pass verifier");
  console.log("TEST A: PASS");

  const b = await runPrompt(
    "TEST B — invoice $5.60 monthly renewal",
    "write an invoice email for a $5.60 monthly renewal",
  );
  assert.equal(b.ok, true, "TEST B must generate");
  assert.ok(["invoice", "renewal_notice"].includes(b.contentType), "TEST B billing type");
  const bBlob = `${b.subject}\n${b.bodyHtml}\n${b.attachmentHtml}`;
  assert.equal(textHasFinancialFields(bBlob), true, "TEST B must include invoice/amount fields");
  assert.equal(b.passedVerification, true, "TEST B must pass verifier");
  console.log("TEST B: PASS");

  const c = await runPrompt("TEST C — vague prompt (retry loop)", "stuff");
  assert.equal(c.ok, true, "TEST C must still return generated content");
  log("TEST C attempts", c.attempts);
  assert.ok(c.attempts.length >= 1, "TEST C recorded attempts");
  console.log("TEST C: logged attempts (pass or honest fail after retries)");

  const d1 = await runPrompt("TEST D — welcome email", "write a welcome email for new customers joining BulkProFire");
  const d2 = await runPrompt("TEST D — password reset", "write a password reset notice with a support contact, no payment info");
  const d3 = await runPrompt("TEST D — generic notification", "notify users that scheduled maintenance is complete and systems are back online");
  for (const [name, r] of [
    ["welcome", d1],
    ["password_reset", d2],
    ["generic", d3],
  ] as const) {
    if (!r.ok) {
      log(`TEST D ${name} FAILED to generate`, { reason: r.reason, attempts: r.attempts });
      assert.fail(`${name} must generate: ${r.reason}`);
    }
    const blob = `${r.subject}\n${r.bodyHtml}\n${r.attachmentHtml}`;
    assert.equal(textHasFinancialFields(blob), false, `${name} must not invent financial fields`);
    console.log(`TEST D ${name}: content_type=${r.contentType} passedVerification=${r.passedVerification}`);
  }

  console.log("\nPipeline proof tests finished.");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
