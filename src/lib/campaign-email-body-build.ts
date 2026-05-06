import "server-only";
import { sanitizeEmailHtml } from "@/lib/html-email";

export async function buildCampaignStorageHtml(params: {
  rawHtml: string;
}): Promise<{
  finalHtml: string;
  warnings: string[];
  truncated: boolean;
}> {
  const warnings: string[] = [];
  const raw = (params.rawHtml ?? "").trim();
  const safeHtml = raw ? sanitizeEmailHtml(params.rawHtml) : "";
  return { finalHtml: safeHtml, warnings, truncated: false };
}
