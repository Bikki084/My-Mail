import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  mergeTagsPromptSection,
  normalizeMergeTagKeys,
} from "./merge-tags-prompt";

describe("merge-tags-prompt", () => {
  it("normalizes and dedupes tag keys", () => {
    assert.deepEqual(normalizeMergeTagKeys(["name", "Name", "email", " bad!", "ok_tag"]), [
      "name",
      "email",
      "ok_tag",
    ]);
  });

  it("lists available tags in prompt section", () => {
    const section = mergeTagsPromptSection(["name", "email"]);
    assert.match(section, /\{\{\{name\}\}\}/);
    assert.match(section, /\{\{\{email\}\}\}/);
    assert.match(section, /three braces/i);
  });

  it("handles empty tag list", () => {
    const section = mergeTagsPromptSection([]);
    assert.match(section, /none provided/i);
  });
});
