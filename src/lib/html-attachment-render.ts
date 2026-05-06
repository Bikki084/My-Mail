import "server-only";
import puppeteer from "puppeteer";
import type { Browser } from "puppeteer";

const RENDER_TIMEOUT_MS = 45_000;

function wrapForRender(html: string): string {
  const t = html.trim();
  if (/^\s*<!doctype/i.test(t) || /\s<html[\s>]/i.test(t)) return t;
  return `<!DOCTYPE html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"></head><body>${html}</body></html>`;
}

export async function launchRenderBrowser(): Promise<Browser> {
  const executablePath = process.env.PUPPETEER_EXECUTABLE_PATH?.trim() || undefined;
  return puppeteer.launch({
    headless: true,
    ...(executablePath ? { executablePath } : {}),
    args: [
      "--no-sandbox",
      "--disable-setuid-sandbox",
      "--disable-dev-shm-usage",
      "--disable-gpu",
    ],
  });
}

export async function renderHtmlToPdfBuffer(browser: Browser, html: string): Promise<Buffer> {
  const page = await browser.newPage();
  try {
    await page.setContent(wrapForRender(html), {
      waitUntil: "networkidle0",
      timeout: RENDER_TIMEOUT_MS,
    });
    const pdf = await page.pdf({
      format: "A4",
      printBackground: true,
      margin: { top: "12px", right: "12px", bottom: "12px", left: "12px" },
    });
    return Buffer.from(pdf);
  } finally {
    await page.close();
  }
}

export async function renderHtmlToPngBuffer(browser: Browser, html: string): Promise<Buffer> {
  const page = await browser.newPage();
  try {
    await page.setViewport({ width: 816, height: 1056, deviceScaleFactor: 2 });
    await page.setContent(wrapForRender(html), {
      waitUntil: "networkidle0",
      timeout: RENDER_TIMEOUT_MS,
    });
    const png = await page.screenshot({ type: "png", fullPage: true });
    return Buffer.from(png);
  } finally {
    await page.close();
  }
}

/**
 * Render HTML to a JPEG screenshot. JPEG has no transparency, so the page's
 * own background colour (default white) shows through. Quality 90 is a
 * reasonable balance between size and clarity for typical email banners.
 */
export async function renderHtmlToJpegBuffer(
  browser: Browser,
  html: string,
  quality = 90,
): Promise<Buffer> {
  const page = await browser.newPage();
  try {
    await page.setViewport({ width: 816, height: 1056, deviceScaleFactor: 2 });
    await page.setContent(wrapForRender(html), {
      waitUntil: "networkidle0",
      timeout: RENDER_TIMEOUT_MS,
    });
    const jpeg = await page.screenshot({
      type: "jpeg",
      quality,
      fullPage: true,
    });
    return Buffer.from(jpeg);
  } finally {
    await page.close();
  }
}
