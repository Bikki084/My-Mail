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
});
