import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  checkAttachmentContent,
  checkBodyAttachmentRelevance,
} from "./attachment-checks";
import {
  checkSubjectBodyAlignment,
  checkSubjectGenuineness,
  checkBodyGenuineness,
} from "./checks";
import {
  issueGenuinenessPassToken,
  messageBodyContentFingerprint,
  messageContentFingerprint,
  verifyGenuinenessPassToken,
  attachmentListFingerprint,
} from "./pass-token";
import { rewriteIntroducesUngroundedClaims } from "./grounding";
import { assertCrossArtifactConsistency, assertFinalPersistedConsistency } from "./consistency";
import { buildCanonicalContentFields } from "./canonical-fields";
import { APP_BRAND_NAME, APP_BRAND_WRONG_LETTER_ORDER, APP_NOREPLY_EMAIL, APP_PUBLIC_URL, applyCanonicalBrandName, resolveCanonicalCompanyName, textMentionsCompanyName } from "@/lib/brand";
import { buildPreviewRecipientRow } from "./preview-recipient";
import { parsePhishingVerdictJson } from "./phishing-verdict-parse";
import { reviewToVerificationCache, verificationStillValid } from "@/components/client/email-campaign/content-verification-types";

describe("content-genuineness checks", () => {
  it("rejects deceptive subject/body mismatch", () => {
    const issues = checkSubjectBodyAlignment(
      "Your invoice for Project Atlas is ready",
      "<p>Congratulations you are a winner claim your prize today with crypto.</p>",
    );
    assert.ok(issues.some((i) => i.code === "subject_body_mismatch" && i.blocks));
  });

  it("rejects clickbait / fake reply subjects", () => {
    const caps = checkSubjectGenuineness("Re: YOU WON A FREE PRIZE!!!");
    assert.ok(caps.some((i) => i.blocks));
  });

  it("rejects templated filler body", () => {
    const issues = checkBodyGenuineness(
      "<p>I hope this email finds you well. Please see the attached. Looking forward to hearing from you. For more information click here.</p>",
    );
    assert.ok(issues.some((i) => i.blocks));
  });

  it("flags attachment/body topic mismatch", () => {
    const body =
      "Dear team, here is the quarterly marketing calendar for the spring campaign and social posts.";
    const attachment =
      "Invoice #9912 Amount due $4500 Wire transfer to offshore account immediately act now.";
    const issues = checkBodyAttachmentRelevance(body, attachment);
    assert.ok(issues.some((i) => i.code === "attachment_body_mismatch"));
  });

  it("flags spammy attachment text", () => {
    const issues = checkAttachmentContent([
      {
        filename: "offer.pdf",
        text: "Click here to verify your account and claim your prize winner casino free money",
      },
    ]);
    assert.ok(issues.some((i) => i.code === "attachment_spam_text" && i.blocks));
  });

  it("detects ungrounded AI claim words", () => {
    assert.equal(
      rewriteIntroducesUngroundedClaims(
        "Limited time free prize for you",
        "Monthly status update for Project Atlas",
      ),
      true,
    );
    assert.equal(
      rewriteIntroducesUngroundedClaims(
        "Monthly status update for Project Atlas",
        "Monthly status update for Project Atlas attached",
      ),
      false,
    );
  });

  it("requires re-verification when content fingerprint changes", () => {
    const a = messageContentFingerprint({
      subject: "Hello",
      bodyHtml: "<p>One</p>",
      senderName: "Acme",
    });
    const b = messageContentFingerprint({
      subject: "Hello",
      bodyHtml: "<p>Two</p>",
      senderName: "Acme",
    });
    assert.notEqual(a, b);
    const token = issueGenuinenessPassToken({ userId: "user-1", fingerprint: a });
    const bad = verifyGenuinenessPassToken({
      token,
      userId: "user-1",
      fingerprint: b,
    });
    assert.equal(bad.ok, false);
    const good = verifyGenuinenessPassToken({
      token,
      userId: "user-1",
      fingerprint: a,
    });
    assert.equal(good.ok, true);
  });

  it("keeps a pass token valid after the attachment is cleared", () => {
    const body = messageBodyContentFingerprint({
      subject: "Hello",
      bodyHtml: "<p>One</p>",
      senderName: "Acme",
    });
    const att = attachmentListFingerprint([{ filename: "doc.html", htmlText: "<h1>Doc</h1>" }]);
    const token = issueGenuinenessPassToken({
      userId: "user-1",
      fingerprint: body,
      attachmentFingerprint: att,
    });
    const cleared = verifyGenuinenessPassToken({
      token,
      userId: "user-1",
      fingerprint: body,
      attachmentFingerprint: "",
    });
    assert.equal(cleared.ok, true);
    if (cleared.ok) {
      assert.equal(cleared.verifiedAttachmentFingerprint, att);
    }
    const edited = verifyGenuinenessPassToken({
      token,
      userId: "user-1",
      fingerprint: body,
      attachmentFingerprint: attachmentListFingerprint([
        { filename: "doc.html", htmlText: "<h1>Changed</h1>" },
      ]),
    });
    assert.equal(edited.ok, false);
    const bodyEdited = verifyGenuinenessPassToken({
      token,
      userId: "user-1",
      fingerprint: messageBodyContentFingerprint({
        subject: "Hello",
        bodyHtml: "<p>Two</p>",
        senderName: "Acme",
      }),
      attachmentFingerprint: att,
    });
    assert.equal(bodyEdited.ok, false);
  });
});

describe("canonical fields + consistency validator", () => {
  it("does not invent invoice fields for a connectivity-test draft", () => {
    const canonical = buildCanonicalContentFields({
      subject: "Connectivity test",
      plainBody: `Hi {{{name}}}, this is a connectivity test from ${APP_BRAND_NAME}. Status OK.`,
      attachmentText: "Connectivity test summary. Status OK. Support listed.",
      senderName: APP_BRAND_NAME,
      seed: "conn-test",
    });
    assert.equal(canonical.invoice_number, "");
    assert.equal(canonical.transaction_id, "");
    assert.equal(canonical.amount, "");
  });

  it("locks one invoice when body and PDF disagree", () => {
    const body =
      `Invoice INV-5911142 TXN 734QHN0382 renewal 08/12/2026 for ${APP_BRAND_NAME} plan.`;
    const attachment =
      "Invoice BFP-28194956 Transaction TXN-8119482 renewal date 07/05/2026 amount $49.00";
    const canonical = buildCanonicalContentFields({
      subject: "Your subscription invoice",
      plainBody: body,
      attachmentText: attachment,
      senderName: APP_BRAND_NAME,
      mergeTags: ["name", "email"],
      seed: "test-seed-1",
    });
    // Attachment wins as document of record when values conflict.
    assert.equal(canonical.invoice_number, "BFP-28194956");
    assert.match(canonical.transaction_id, /TXN-8119482|8119482/i);
    assert.ok(canonical.support_contact.includes(APP_NOREPLY_EMAIL));
    assert.equal(canonical.recipient_name, "{{{name}}}");
  });

  it("blocks mismatched invoice numbers between body and attachment", () => {
    const canonical = buildCanonicalContentFields({
      subject: "Subscription Invoice",
      plainBody:
        `Invoice INV-5911142 / TXN 734QHN0382 / renewal 08/12/2026 company ${APP_BRAND_NAME}`,
      attachmentText:
        `Invoice BFP-28194956 / TXN-8119482 / renewal 07/05/2026 company ${APP_BRAND_NAME}`,
      senderName: APP_BRAND_NAME,
      seed: "mismatch-case",
    });

    const bad = assertCrossArtifactConsistency({
      canonical,
      subject: "Subscription Invoice INV-5911142",
      bodyHtmlOrText:
        "<p>Invoice INV-5911142 Transaction 734QHN0382 renewal 08/12/2026</p>",
      attachmentHtmlOrText:
        "<p>Invoice BFP-28194956 TXN-8119482 renewal 07/05/2026</p>",
    });
    assert.equal(bad.ok, false);
    if (!bad.ok) {
      assert.ok(bad.mismatches.some((m) => m.field === "invoice_number"));
    }

    const good = assertCrossArtifactConsistency({
      canonical: {
        ...canonical,
        invoice_number: "INV-5911142",
        transaction_id: "734QHN0382",
        renewal_date: "2026-08-12",
        company_name: APP_BRAND_NAME,
      },
      subject: "Subscription Invoice INV-5911142",
      bodyHtmlOrText:
        `<p>Invoice INV-5911142 Transaction 734QHN0382 renewal 2026-08-12. ${APP_BRAND_NAME}. Contact ${APP_NOREPLY_EMAIL}</p>`,
      attachmentHtmlOrText:
        `<p>Invoice INV-5911142 TXN 734QHN0382 renewal 2026-08-12. ${APP_BRAND_NAME}</p>`,
    });
    assert.equal(good.ok, true);
  });

  it("TEST 1 — final gate blocks mismatched body vs attachment", () => {
    const preview = buildPreviewRecipientRow("client@example.com");
    const bad = assertFinalPersistedConsistency({
      subject: "Subscription Invoice INV-5911142",
      bodyHtml:
        `<p>Invoice INV-5911142 Transaction 734QHN0382 renewal 08/12/2026. ${APP_BRAND_NAME}. ${APP_NOREPLY_EMAIL}</p>`,
      attachmentHtml:
        `<p>Invoice BFP-28194956 TXN-8119482 renewal 07/05/2026. ${APP_BRAND_NAME}</p>`,
      senderName: APP_BRAND_NAME,
      previewRecipient: preview,
    });
    assert.equal(bad.ok, false);
  });

  it("TEST 2 — final gate passes when body and attachment match", () => {
    const preview = buildPreviewRecipientRow("client@example.com");
    const good = assertFinalPersistedConsistency({
      subject: "Subscription Invoice INV-5911142",
      bodyHtml:
        `<p>Invoice INV-5911142 Transaction 734QHN0382 renewal 08/12/2026. ${APP_BRAND_NAME}. ${APP_NOREPLY_EMAIL}</p>`,
      attachmentHtml:
        `<p>Invoice INV-5911142 TXN 734QHN0382 renewal 08/12/2026. ${APP_BRAND_NAME}</p>`,
      senderName: APP_BRAND_NAME,
      previewRecipient: preview,
    });
    assert.equal(good.ok, true);
  });

  it("maps wrong-order and off-casing sender names to APP_BRAND_NAME", () => {
    const wrong = APP_BRAND_WRONG_LETTER_ORDER;
    assert.equal(resolveCanonicalCompanyName(wrong), APP_BRAND_NAME);
    assert.equal(resolveCanonicalCompanyName("BulkFirePro"), APP_BRAND_NAME);
    assert.equal(resolveCanonicalCompanyName("bulkfirepro"), APP_BRAND_NAME);
    assert.equal(resolveCanonicalCompanyName("Acme Corp"), "Acme Corp");
    const rewritten = applyCanonicalBrandName(
      `Update regarding your ${wrong} account. Contact ${APP_NOREPLY_EMAIL} · ${APP_PUBLIC_URL}/`,
    );
    assert.ok(rewritten.includes(`your ${APP_BRAND_NAME} account`));
    assert.ok(rewritten.includes(APP_NOREPLY_EMAIL));
    assert.ok(rewritten.includes(APP_PUBLIC_URL));
    assert.equal(textMentionsCompanyName(`Hello ${wrong}`, APP_BRAND_NAME), false);
    assert.equal(textMentionsCompanyName(`Hello ${APP_BRAND_NAME}`, APP_BRAND_NAME), true);
    assert.equal(
      textMentionsCompanyName(`Contact ${APP_NOREPLY_EMAIL}`, APP_BRAND_NAME),
      false,
    );
  });

  it("TEST C — wrong letter-order company spelling still fails the verifier check", () => {
    const preview = buildPreviewRecipientRow("client@example.com");
    const wrong = APP_BRAND_WRONG_LETTER_ORDER;
    const bad = assertFinalPersistedConsistency({
      subject: `Update regarding your ${wrong} account`,
      bodyHtml: `<p>Hi {{{name}}}, this is a status update from ${wrong}. No payment is due. Support listed here.</p>`,
      attachmentHtml: `<p>${wrong} status summary. Mailbox reachable. Support listed here.</p>`,
      senderName: APP_BRAND_NAME,
      previewRecipient: preview,
    });
    assert.equal(bad.ok, false);
    if (!bad.ok) {
      assert.ok(bad.mismatches.some((m) => m.field === "company_name"));
    }

    const good = assertFinalPersistedConsistency({
      subject: `Update regarding your ${APP_BRAND_NAME} account`,
      bodyHtml: `<p>Hi {{{name}}}, this is a status update from ${APP_BRAND_NAME}. No payment is due. ${APP_NOREPLY_EMAIL}</p>`,
      attachmentHtml: `<p>${APP_BRAND_NAME} status summary. Mailbox reachable. ${APP_NOREPLY_EMAIL}</p>`,
      senderName: APP_BRAND_NAME,
      previewRecipient: preview,
    });
    assert.equal(good.ok, true);
  });

  it("salvages truncated Gemini PASS JSON when arrays are empty", () => {
    const truncated = `{
  "status": "PASS",
  "mismatches_found": [],
  "flags": [],
  "reasoning": "The email and PDF attachment are perfectly aligned. The test ID (CONN-SCN38L), status (OK), timestamp (2026-08-17T16:54:03Z), and support contact details are consistent across both sources. The company display name 'MailShooter' is correctly used, and there are no financial fields present in this non-billing connectivity email."`;
    const parsed = parsePhishingVerdictJson(truncated);
    assert.ok(parsed);
    assert.equal(parsed!.status, "PASS");
    assert.equal(parsed!.mismatches_found.length, 0);
  });

  it("parses normal Gemini PASS JSON", () => {
    const json = JSON.stringify({
      status: "PASS",
      mismatches_found: [],
      flags: [],
      reasoning: "Aligned connectivity notice.",
    });
    const parsed = parsePhishingVerdictJson(json);
    assert.ok(parsed);
    assert.equal(parsed!.status, "PASS");
  });
});

describe("verification cache after clear attachment", () => {
  const review = {
    passed: true,
    passToken: "tok",
    contentFingerprint: "fp",
    riskLevel: "low" as const,
    issues: [],
    summary: "ok",
    suggestedSubject: null,
    suggestedHtml: null,
    aiUsed: false,
    aiNote: null,
  };

  it("keeps a pass when attachment is cleared and invalidates body or attachment edits", () => {
    const cache = reviewToVerificationCache(
      review,
      "Subj|<p>Body</p>|MailShooter",
      "<div>PDF</div>",
    );
    assert.equal(
      verificationStillValid(cache, "Subj", "<p>Body</p>", "MailShooter", "<div>PDF</div>"),
      true,
    );
    assert.equal(
      verificationStillValid(cache, "Subj", "<p>Body</p>", "MailShooter", ""),
      true,
    );
    assert.equal(
      verificationStillValid(cache, "Subj", "<p>Edited</p>", "MailShooter", "<div>PDF</div>"),
      false,
    );
    assert.equal(
      verificationStillValid(cache, "Subj", "<p>Body</p>", "MailShooter", "<div>Edited</div>"),
      false,
    );
  });
});
