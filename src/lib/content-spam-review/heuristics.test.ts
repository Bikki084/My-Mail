import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { analyzeContentHeuristics } from "./heuristics";

describe("content-spam heuristics", () => {
  it("flags fake reply subject prefix", () => {
    const r = analyzeContentHeuristics({
      subject: "Re: Your account needs attention",
      bodyHtml: "<p>" + "word ".repeat(30) + "</p>",
      senderName: "Acme",
    });
    assert.ok(r.issues.some((i) => i.code === "fake_reply_subject"));
  });

  it("flags hidden HTML text", () => {
    const r = analyzeContentHeuristics({
      subject: "Monthly update",
      bodyHtml: `<p>Hello</p><div style="display:none">spam words free urgent</div><p>${"word ".repeat(30)}</p>`,
      senderName: "Acme",
    });
    assert.ok(r.issues.some((i) => i.code === "hidden_text"));
  });

  it("flags high risk spam phrases", () => {
    const r = analyzeContentHeuristics({
      subject: "ACT NOW!!! FREE WINNER — LIMITED TIME",
      bodyHtml: "<p>Click here to claim your prize. Verify your account immediately. Wire transfer required.</p>",
      senderName: "",
    });
    assert.equal(r.level, "high");
  });

  it("does not treat genuine notices as spam bait", () => {
    const genuine = analyzeContentHeuristics({
      subject: "MailShooter account recovery notice",
      bodyHtml:
        "<p>Hi {{{name}}}, we received a request to change the password on your MailShooter account. Sign in at https://mailshooter.in if you made this request. Feel free to write to support if you have questions.</p>",
      senderName: "MailShooter",
    });
    assert.equal(
      genuine.issues.some((i) => i.code === "spam_phrase"),
      false,
    );

    const phishingReset = analyzeContentHeuristics({
      subject: "Reset now",
      bodyHtml: "<p>Click here to reset your password immediately and verify your account.</p>",
      senderName: "MailShooter",
    });
    assert.ok(phishingReset.issues.some((i) => i.code === "spam_phrase"));
  });
});
