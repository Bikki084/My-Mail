import { readFileSync } from "node:fs";
import { join } from "node:path";
import { APP_BRAND_NAME } from "@/lib/brand";

let cachedDataUri: string | null = null;

/** Inline SVG logo — works in Puppeteer PDF renders (no external fetch). */
export function brandLogoDataUri(): string {
  if (cachedDataUri) return cachedDataUri;
  try {
    const svgPath = join(process.cwd(), "src", "app", "icon.svg");
    const svg = readFileSync(svgPath, "utf8");
    cachedDataUri = `data:image/svg+xml;base64,${Buffer.from(svg).toString("base64")}`;
    return cachedDataUri;
  } catch {
    cachedDataUri =
      "data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHZpZXdCb3g9IjAgMCAzMiAzMiIgZmlsbD0ibm9uZSI+PHJlY3Qgd2lkdGg9IjMyIiBoZWlnaHQ9IjMyIiByeD0iOSIgZmlsbD0iIzBkOTQ4OCIvPjxwYXRoIGQ9Im0yMiA3LTguOTcgNS43YTIgMiAwIDAgMS0yLjA2IDBMMCA3IiBzdHJva2U9IiNmZmYiIHN0cm9rZS13aWR0aD0iMiIvPjwvc3ZnPg==";
    return cachedDataUri;
  }
}

export function brandLogoImgHtml(width = 48): string {
  const src = brandLogoDataUri();
  return `<img src="${src}" alt="${APP_BRAND_NAME}" width="${width}" height="${width}" style="display:block;margin:0 0 12px 0;" />`;
}

const BROKEN_LOGO_SRC =
  /src\s*=\s*["'](?:https?:\/\/[^"']*(?:logo|favicon|icon)[^"']*|\/[^"']*(?:logo|favicon|icon)[^"']*)["']/gi;

/** Replace broken remote logo URLs and ensure a logo appears in attachment HTML when requested. */
export function ensureBrandLogoInAttachmentHtml(
  attachmentHtml: string,
  opts?: { brief?: string; force?: boolean },
): string {
  let html = attachmentHtml.trim();
  if (!html) return html;

  const brief = (opts?.brief ?? "").toLowerCase();
  const wantsLogo =
    opts?.force === true ||
    /\b(logo|brand mark|brand icon|company icon)\b/i.test(brief);

  const logoTag = brandLogoImgHtml(52);
  html = html.replace(BROKEN_LOGO_SRC, `src="${brandLogoDataUri()}"`);

  if (!wantsLogo) return html;

  if (/<img[^>]+src\s*=\s*["']data:image\/svg\+xml/i.test(html)) {
    return html;
  }

  if (/<img[^>]+alt\s*=\s*["'][^"']*mailshooter/i.test(html)) {
    return html.replace(/<img[^>]*>/i, logoTag);
  }

  if (/<h1[^>]*>/i.test(html)) {
    return html.replace(/<h1/i, `${logoTag}<h1`);
  }

  return `${logoTag}${html}`;
}
