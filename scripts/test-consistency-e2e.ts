/**
 * End-to-end consistency tests (runs real validation code paths, no mocks).
 * Usage: npx tsx scripts/test-consistency-e2e.ts
 */
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { assertFinalPersistedConsistency, extractPersistedFieldSets } from "../src/lib/content-genuineness/consistency";
import { buildPreviewRecipientRow } from "../src/lib/content-genuineness/preview-recipient";
import { APP_NOREPLY_EMAIL } from "../src/lib/brand";

function sha256(text: string): string {
  return createHash("sha256").update(text).digest("hex");
}

function log(title: string, data: unknown) {
  console.log(`\n=== ${title} ===`);
  console.log(typeof data === "string" ? data : JSON.stringify(data, null, 2));
}

const preview = buildPreviewRecipientRow("client@example.com");
const sender = "BulkProFire";

console.log("Consistency E2E tests\n");

// TEST 1 — mismatched bug data
{
  const bodyHtml = `<p>Invoice INV-5911142 Transaction 734QHN0382 renewal 08/12/2026. ${sender}. Support: ${APP_NOREPLY_EMAIL}</p>`;
  const attachmentHtml = `<p>Invoice BFP-28194956 TXN-8119482 renewal 07/05/2026 amount $49.00. ${sender}</p>`;
  const result = assertFinalPersistedConsistency({
    subject: "Subscription Invoice INV-5911142",
    bodyHtml,
    attachmentHtml,
    senderName: sender,
    previewRecipient: preview,
  });
  log("TEST 1 — mismatched mock (expected FAIL)", {
    ok: result.ok,
    bodyFields: result.bodyFields,
    attachmentFields: result.attachmentFields,
    mismatches: result.ok ? [] : result.mismatches.map((m) => m.detail),
  });
  assert.equal(result.ok, false, "TEST 1 should FAIL");
}

// TEST 2 — consistent data
{
  const bodyHtml = `<p>Invoice INV-5911142 Transaction 734QHN0382 renewal 08/12/2026 amount $49.00. ${sender}. Support: ${APP_NOREPLY_EMAIL}</p>`;
  const attachmentHtml = `<p>Invoice INV-5911142 TXN 734QHN0382 renewal 08/12/2026 amount $49.00. ${sender}</p>`;
  const result = assertFinalPersistedConsistency({
    subject: "Subscription Invoice INV-5911142",
    bodyHtml,
    attachmentHtml,
    senderName: sender,
    previewRecipient: preview,
  });
  log("TEST 2 — consistent mock (expected PASS)", {
    ok: result.ok,
    bodyFields: result.bodyFields,
    attachmentFields: result.attachmentFields,
  });
  assert.equal(result.ok, true, "TEST 2 should PASS");
}

// TEST 3 — simulate Apply Both applied content
{
  const canonicalInvoice = "INV-9021847";
  const canonicalTxn = "902GJL7394";
  const canonicalDate = "08/12/2026";
  const appliedSubject = `Your ${sender} invoice ${canonicalInvoice}`;
  const appliedBody = `<p>Dear Preview User, your invoice ${canonicalInvoice} transaction ${canonicalTxn} renews ${canonicalDate}. ${sender}. ${APP_NOREPLY_EMAIL}</p>`;
  const appliedAttachment = `<h1>${sender}</h1><p>Invoice ${canonicalInvoice}<br/>Transaction ${canonicalTxn}<br/>Renewal ${canonicalDate}</p>`;

  const sets = extractPersistedFieldSets({
    subject: appliedSubject,
    bodyHtml: appliedBody,
    attachmentHtml: appliedAttachment,
    previewRecipient: preview,
  });
  const result = assertFinalPersistedConsistency({
    subject: appliedSubject,
    bodyHtml: appliedBody,
    attachmentHtml: appliedAttachment,
    senderName: sender,
    previewRecipient: preview,
  });
  log("TEST 3 — Apply Both simulated final content", {
    bodyExtracted: sets.bodyFields,
    attachmentExtracted: sets.attachmentFields,
    pass: result.ok,
  });
  assert.equal(result.ok, true, "TEST 3 should PASS");
}

// TEST 4 — cache-busting / content hash changes between generations
{
  const gen1 = `<p>Invoice INV-1111111 TXN 111AAA1111 renewal 01/01/2026. ${sender}</p>`;
  const gen2 = `<p>Invoice INV-2222222 TXN 222BBB2222 renewal 02/02/2026. ${sender}</p>`;
  const hash1 = sha256(gen1);
  const hash2 = sha256(gen2);
  log("TEST 4 — attachment HTML hash comparison", {
    generation1Bytes: Buffer.byteLength(gen1),
    generation1Sha256: hash1,
    generation2Bytes: Buffer.byteLength(gen2),
    generation2Sha256: hash2,
    hashesDiffer: hash1 !== hash2,
  });
  assert.notEqual(hash1, hash2, "TEST 4 hashes must differ");
}

// TEST 5 — Apply Body only with stale attachment (expected FAIL)
{
  const newBody = `<p>Invoice INV-5911142 Transaction 734QHN0382 renewal 08/12/2026. ${sender}. ${APP_NOREPLY_EMAIL}</p>`;
  const staleAttachment = `<p>Invoice BFP-28194956 TXN-8119482 renewal 07/05/2026. ${sender}</p>`;
  const result = assertFinalPersistedConsistency({
    subject: "Invoice",
    bodyHtml: newBody,
    attachmentHtml: staleAttachment,
    senderName: sender,
    previewRecipient: preview,
  });
  log("TEST 5 — Apply Body only, stale attachment (expected FAIL)", {
    ok: result.ok,
    bodyFields: result.bodyFields,
    attachmentFields: result.attachmentFields,
    note: "Apply Subject/Body/Both always rewrites attachment when AI suggestion exists; stale attachment must fail final gate.",
    mismatches: result.ok ? [] : result.mismatches.map((m) => m.detail),
  });
  assert.equal(result.ok, false, "TEST 5 should FAIL without attachment realignment");
}

console.log("\nAll 5 consistency E2E tests passed.\n");
