import "server-only";

/**
 * Dynamic import keeps resolution in node_modules (with `serverExternalPackages`) so PDF.js workers load correctly.
 */
export async function extractPdfTextFromBuffer(buffer: Buffer): Promise<string> {
  const { PDFParse } = await import("pdf-parse");
  const copy = new Uint8Array(buffer.byteLength);
  copy.set(buffer);
  const parser = new PDFParse({ data: copy });
  try {
    const result = await parser.getText();
    return result.text ?? "";
  } finally {
    await parser.destroy();
  }
}
