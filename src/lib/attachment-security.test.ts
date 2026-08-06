import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  detectFileKind,
  validateAllAttachments,
  validateAttachmentSecurity,
} from "./attachment-security";

describe("attachment-security", () => {
  it("blocks .exe extension", () => {
    const buf = Buffer.from([0x4d, 0x5a, 0x90, 0x00]);
    const r = validateAttachmentSecurity({ filename: "setup.exe", buffer: buf });
    assert.equal(r.ok, false);
    if (!r.ok) assert.equal(r.code, "blocked_extension");
  });

  it("blocks PE executable even with .pdf extension", () => {
    const buf = Buffer.from([0x4d, 0x5a, 0x90, 0x00, 0x03]);
    const r = validateAttachmentSecurity({ filename: "invoice.pdf", buffer: buf });
    assert.equal(r.ok, false);
    if (!r.ok) {
      assert.ok(
        r.code === "extension_mismatch" || r.code === "blocked_content_type",
      );
      assert.match(r.message, /invoice\.pdf/i);
    }
  });

  it("blocks macro-enabled Office formats", () => {
    const zipHeader = Buffer.from([0x50, 0x4b, 0x03, 0x04, 0x00]);
    const r = validateAttachmentSecurity({ filename: "report.docm", buffer: zipHeader });
    assert.equal(r.ok, false);
    if (!r.ok) assert.equal(r.code, "blocked_extension");
  });

  it("allows valid PDF", () => {
    const buf = Buffer.from("%PDF-1.4 fake content");
    const r = validateAttachmentSecurity({ filename: "doc.pdf", buffer: buf });
    assert.equal(r.ok, true);
    assert.equal(detectFileKind(buf), "pdf");
  });

  it("validateAllAttachments stops at first failure", () => {
    const good = Buffer.from("%PDF-1.4");
    const bad = Buffer.from([0x4d, 0x5a]);
    const r = validateAllAttachments([
      { filename: "ok.pdf", buffer: good },
      { filename: "bad.exe", buffer: bad },
    ]);
    assert.equal(r.ok, false);
    if (!r.ok) assert.match(r.filename, /bad\.exe/);
  });
});
