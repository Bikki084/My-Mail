import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  countMeaningfulWords,
  isBoilerplateOrPlaceholder,
  validateContentQuality,
} from "./content-quality-validation";

describe("content-quality-validation", () => {
  it("rejects empty body", () => {
    const r = validateContentQuality({ bodyHtml: "<p></p>" });
    assert.equal(r.ok, false);
    if (!r.ok) assert.equal(r.code, "empty_body");
  });

  it("rejects short body below minimum word count", () => {
    const r = validateContentQuality({
      bodyHtml: "<p>Hello world this is only eight words total here.</p>",
      minWords: 25,
    });
    assert.equal(r.ok, false);
    if (!r.ok) {
      assert.equal(r.code, "body_too_short");
      assert.match(r.message, /minimum required is 25/);
    }
  });

  it("rejects placeholder boilerplate", () => {
    const r = validateContentQuality({
      bodyHtml: "<p>test</p>",
      minWords: 1,
    });
    assert.equal(r.ok, false);
    if (!r.ok) assert.equal(r.code, "placeholder_body");
  });

  it("rejects low text-to-attachment ratio", () => {
    const words = Array.from({ length: 30 }, (_, i) => `word${i}`).join(" ");
    const r = validateContentQuality({
      bodyHtml: `<p>${words}</p>`,
      attachmentTotalBytes: 2 * 1024 * 1024,
      minWords: 25,
      minTextCharsPerAttachmentKb: 50,
    });
    assert.equal(r.ok, false);
    if (!r.ok) {
      assert.equal(r.code, "attachment_text_ratio");
      assert.match(r.message, /ratio too low/i);
    }
  });

  it("accepts sufficient body without attachments", () => {
    const words = Array.from({ length: 30 }, (_, i) => `word${i}`).join(" ");
    const r = validateContentQuality({
      bodyHtml: `<p>${words}</p>`,
      minWords: 25,
    });
    assert.equal(r.ok, true);
    if (r.ok) assert.ok(r.wordCount >= 25);
  });

  it("detects repeated-character placeholders", () => {
    assert.equal(isBoilerplateOrPlaceholder("........"), true);
  });

  it("counts words correctly", () => {
    assert.equal(countMeaningfulWords("  one two   three  "), 3);
  });
});
