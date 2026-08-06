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
