import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  classifySmtpErrorForGuard,
  computeCompositeScore,
  shouldTripCompositePause,
} from "./deliverability-guard-logic";

describe("deliverability-guard-logic", () => {
  it("classifies SendGrid account suspension messages", () => {
    assert.equal(
      classifySmtpErrorForGuard("Account suspended due to reputation issues"),
      "esp_account_risk",
    );
  });

  it("classifies spam SMTP rejects", () => {
    assert.equal(
      classifySmtpErrorForGuard("550 5.7.1 Message rejected as spam"),
      "smtp_spam_reject",
    );
  });

  it("trips composite score on mixed bad signals", () => {
    const score = computeCompositeScore({
      spam_report: 1,
      blocked: 1,
    });
    assert.ok(score >= 12);
    assert.equal(shouldTripCompositePause(score), true);
  });

  it("does not trip composite on minor signals alone", () => {
    const score = computeCompositeScore({ hard_bounce: 2 });
    assert.equal(shouldTripCompositePause(score), false);
  });
});
