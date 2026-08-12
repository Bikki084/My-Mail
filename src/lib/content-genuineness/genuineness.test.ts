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
  messageContentFingerprint,
  verifyGenuinenessPassToken,
} from "./pass-token";
import { rewriteIntroducesUngroundedClaims } from "./grounding";
import { assertCrossArtifactConsistency } from "./consistency";
import { buildCanonicalContentFields } from "./canonical-fields";
import { APP_NOREPLY_EMAIL } from "@/lib/brand";

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
});

describe("canonical fields + consistency validator", () => {
  it("locks one invoice when body and PDF disagree", () => {
    const body =
      "Invoice INV-5911142 TXN 734QHN0382 renewal 08/12/2026 for BulkProFire plan.";
    const attachment =
      "Invoice BFP-28194956 Transaction TXN-8119482 renewal date 07/05/2026 amount $49.00";
    const canonical = buildCanonicalContentFields({
      subject: "Your subscription invoice",
      plainBody: body,
      attachmentText: attachment,
      senderName: "BulkProFire",
      mergeTags: ["name", "email"],
      seed: "test-seed-1",
    });
    // Attachment wins as document of record when values conflict.
    assert.equal(canonical.invoice_number, "BFP-28194956");
    assert.match(canonical.transaction_id, /TXN-8119482|8119482/i);
    assert.ok(canonical.support_contact.includes(APP_NOREPLY_EMAIL));
    assert.equal(canonical.recipient_name, "{{{name}}}");
  });

  it("blocks mismatched mock data like the BulkFirePro phishing example", () => {
    const canonical = buildCanonicalContentFields({
      subject: "Subscription Invoice",
      plainBody:
        "Invoice INV-5911142 / TXN 734QHN0382 / renewal 08/12/2026 company BulkProFire",
      attachmentText:
        "Invoice BFP-28194956 / TXN-8119482 / renewal 07/05/2026 company BulkProFire",
      senderName: "BulkProFire",
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
      },
      subject: "Subscription Invoice INV-5911142",
      bodyHtmlOrText:
        `<p>Invoice INV-5911142 Transaction 734QHN0382 renewal 2026-08-12. Contact ${APP_NOREPLY_EMAIL}</p>`,
      attachmentHtmlOrText:
        "<p>Invoice INV-5911142 TXN 734QHN0382 renewal 2026-08-12</p>",
    });
    assert.equal(good.ok, true);
  });
});
