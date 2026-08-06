import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { contentReviewFingerprint } from "./fingerprint";

describe("content rescore fingerprint", () => {
  it("is stable for identical content", () => {
    const a = contentReviewFingerprint({
      subject: "Hello",
      bodyHtml: "<p>Body</p>",
      senderName: "Acme",
    });
    const b = contentReviewFingerprint({
      subject: "Hello",
      bodyHtml: "<p>Body</p>",
      senderName: "Acme",
    });
    assert.equal(a, b);
    assert.equal(a.length, 32);
  });

  it("changes when content changes", () => {
    const a = contentReviewFingerprint({
      subject: "Hello",
      bodyHtml: "<p>Body</p>",
      senderName: "Acme",
    });
    const b = contentReviewFingerprint({
      subject: "Hello!",
      bodyHtml: "<p>Body</p>",
      senderName: "Acme",
    });
    assert.notEqual(a, b);
  });
});
