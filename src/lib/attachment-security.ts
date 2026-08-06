export type DetectedFileKind =
  | "pdf"
  | "png"
  | "jpeg"
  | "gif"
  | "zip"
  | "pe_executable"
  | "javascript"
  | "batch_script"
  | "vbscript"
  | "unknown";

export type AttachmentSecurityFailureCode =
  | "blocked_extension"
  | "blocked_mime"
  | "extension_mismatch"
  | "blocked_content_type";

export type AttachmentInput = {
  filename: string;
  buffer: Buffer;
};

export type AttachmentSecurityResult =
  | { ok: true }
  | {
      ok: false;
      code: AttachmentSecurityFailureCode;
      message: string;
      filename: string;
      declaredExtension?: string;
      detectedKind?: DetectedFileKind;
    };

/** Extensions never allowed as attachments. */
export const BLOCKED_ATTACHMENT_EXTENSIONS = new Set([
  ".exe",
  ".scr",
  ".bat",
  ".cmd",
  ".com",
  ".pif",
  ".vbs",
  ".js",
  ".jar",
  ".msi",
  ".docm",
  ".xlsm",
  ".pptm",
]);

/** Map detected kinds that are always blocked regardless of declared extension. */
const BLOCKED_DETECTED_KINDS = new Set<DetectedFileKind>([
  "pe_executable",
  "javascript",
  "batch_script",
  "vbscript",
]);

const EXTENSION_TO_EXPECTED_KIND: Record<string, DetectedFileKind[]> = {
  ".pdf": ["pdf"],
  ".png": ["png"],
  ".jpg": ["jpeg"],
  ".jpeg": ["jpeg"],
  ".gif": ["gif"],
  ".zip": ["zip"],
  ".docx": ["zip"],
  ".xlsx": ["zip"],
  ".pptx": ["zip"],
  ".docm": ["zip"],
  ".xlsm": ["zip"],
  ".pptm": ["zip"],
  ".jar": ["zip", "pe_executable"],
};

export function extensionOf(filename: string): string {
  const lower = filename.toLowerCase().trim();
  const dot = lower.lastIndexOf(".");
  if (dot <= 0) return "";
  return lower.slice(dot);
}

export function detectFileKind(buffer: Buffer): DetectedFileKind {
  if (buffer.length >= 4 && buffer.subarray(0, 4).toString("ascii") === "%PDF") {
    return "pdf";
  }
  if (buffer.length >= 2 && buffer[0] === 0x4d && buffer[1] === 0x5a) {
    return "pe_executable";
  }
  if (
    buffer.length >= 4 &&
    buffer[0] === 0x50 &&
    buffer[1] === 0x4b &&
    (buffer[2] === 0x03 || buffer[2] === 0x05 || buffer[2] === 0x07)
  ) {
    return "zip";
  }
  if (
    buffer.length >= 8 &&
    buffer.subarray(0, 8).toString("ascii").startsWith("\x89PNG\r\n\x1a\n")
  ) {
    return "png";
  }
  if (buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) {
    return "jpeg";
  }
  if (
    buffer.length >= 6 &&
    (buffer.subarray(0, 6).toString("ascii") === "GIF87a" ||
      buffer.subarray(0, 6).toString("ascii") === "GIF89a")
  ) {
    return "gif";
  }
  const head = buffer.subarray(0, Math.min(buffer.length, 512)).toString("utf8").trimStart();
  if (/^@echo\s+/i.test(head) || /^rem\s+/i.test(head)) {
    return "batch_script";
  }
  if (/^<\?xml|^<html|^<!DOCTYPE/i.test(head) && /\.vbs$/i.test(head)) {
    return "vbscript";
  }
  if (/^(import\s+|export\s+|const\s+|let\s+|var\s+|function\s*\()/m.test(head)) {
    return "javascript";
  }
  return "unknown";
}

function isMacroEnabledOffice(filename: string, kind: DetectedFileKind): boolean {
  const ext = extensionOf(filename);
  if (ext === ".docm" || ext === ".xlsm" || ext === ".pptm") return true;
  if (kind !== "zip") return false;
  return ext === ".docm" || ext === ".xlsm" || ext === ".pptm";
}

export function validateAttachmentSecurity(
  attachment: AttachmentInput,
): AttachmentSecurityResult {
  const filename = attachment.filename.trim() || "attachment";
  const ext = extensionOf(filename);
  const detected = detectFileKind(attachment.buffer);

  if (ext && BLOCKED_ATTACHMENT_EXTENSIONS.has(ext)) {
    return {
      ok: false,
      code: "blocked_extension",
      message: `Blocked attachment type: “${filename}” (${ext} files are not allowed). Remove this file and try again.`,
      filename,
      declaredExtension: ext,
      detectedKind: detected,
    };
  }

  if (BLOCKED_DETECTED_KINDS.has(detected)) {
    const label =
      detected === "pe_executable"
        ? "executable"
        : detected === "javascript"
          ? "JavaScript"
          : detected === "batch_script"
            ? "batch script"
            : "script";
    return {
      ok: false,
      code: "blocked_content_type",
      message: `Blocked attachment: “${filename}” appears to be a ${label} file. Executable and script attachments are not allowed.`,
      filename,
      declaredExtension: ext || undefined,
      detectedKind: detected,
    };
  }

  if (isMacroEnabledOffice(filename, detected)) {
    return {
      ok: false,
      code: "blocked_extension",
      message: `Blocked attachment type: “${filename}” (macro-enabled Office files .docm/.xlsm/.pptm are not allowed).`,
      filename,
      declaredExtension: ext,
      detectedKind: detected,
    };
  }

  if (ext && EXTENSION_TO_EXPECTED_KIND[ext]) {
    const allowed = EXTENSION_TO_EXPECTED_KIND[ext]!;
    if (detected !== "unknown" && !allowed.includes(detected)) {
      return {
        ok: false,
        code: "extension_mismatch",
        message: `Attachment “${filename}” has extension ${ext} but file content does not match (detected: ${detected}). Renamed or disguised files are not allowed.`,
        filename,
        declaredExtension: ext,
        detectedKind: detected,
      };
    }
  }

  // Standalone .js blocked even if content detection missed it
  if (ext === ".js") {
    return {
      ok: false,
      code: "blocked_extension",
      message: `Blocked attachment type: “${filename}” (.js files are not allowed as attachments).`,
      filename,
      declaredExtension: ext,
      detectedKind: detected,
    };
  }

  return { ok: true };
}

export function validateAllAttachments(
  attachments: AttachmentInput[],
): AttachmentSecurityResult {
  for (const a of attachments) {
    const result = validateAttachmentSecurity(a);
    if (!result.ok) return result;
  }
  return { ok: true };
}

export function attachmentTotalBytes(attachments: AttachmentInput[]): number {
  return attachments.reduce((sum, a) => sum + a.buffer.length, 0);
}

export function attachmentsFromBase64Rows(
  rows: { filename: string; contentBase64: string }[],
): AttachmentInput[] {
  return rows.map((r) => ({
    filename: r.filename,
    buffer: Buffer.from(r.contentBase64, "base64"),
  }));
}
