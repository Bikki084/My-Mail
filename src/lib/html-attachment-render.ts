import "server-only";
import { existsSync } from "node:fs";
import puppeteer from "puppeteer";
import type { Browser, Page } from "puppeteer";
import { parsePositiveIntEnv } from "@/lib/async-pool";

const RENDER_TIMEOUT_MS = parsePositiveIntEnv("HTML_RENDER_TIMEOUT_MS", 20_000);

const LINUX_CHROMIUM_CANDIDATES = [
  "/usr/bin/chromium-browser",
  "/usr/bin/chromium",
  "/usr/bin/google-chrome-stable",
  "/usr/bin/google-chrome",
  "/snap/bin/chromium",
];

type RenderWaitUntil = "domcontentloaded" | "load" | "networkidle0" | "networkidle2";

function renderWaitUntil(): RenderWaitUntil {
  const raw = process.env.HTML_RENDER_WAIT_UNTIL?.trim().toLowerCase();
  if (
    raw === "domcontentloaded" ||
    raw === "load" ||
    raw === "networkidle0" ||
    raw === "networkidle2"
  ) {
    return raw;
  }
  return "domcontentloaded";
}

/** Prefer explicit env, then system Chromium on Linux VPS, then Puppeteer's bundled Chrome. */
export function resolveChromiumExecutablePath(): string | undefined {
  const fromEnv = process.env.PUPPETEER_EXECUTABLE_PATH?.trim();
  if (fromEnv && existsSync(fromEnv)) return fromEnv;
  if (process.platform === "linux") {
    for (const p of LINUX_CHROMIUM_CANDIDATES) {
      if (existsSync(p)) return p;
    }
  }
  return undefined;
}

function wrapForRender(html: string): string {
  const t = html.trim();
  if (/^\s*<!doctype/i.test(t) || /\s<html[\s>]/i.test(t)) return t;
  return `<!DOCTYPE html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"></head><body>${html}</body></html>`;
}

export async function launchRenderBrowser(): Promise<Browser> {
  const executablePath = resolveChromiumExecutablePath();
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

async function withTimeout<T>(promise: Promise<T>, label: string): Promise<T> {
  return Promise.race([
    promise,
    new Promise<T>((_, reject) => {
      setTimeout(
        () => reject(new Error(`${label} timed out after ${RENDER_TIMEOUT_MS}ms`)),
        RENDER_TIMEOUT_MS,
      );
    }),
  ]);
}

async function withFreshPage<T>(
  browser: Browser,
  fn: (page: Page) => Promise<T>,
): Promise<T> {
  const page = await browser.newPage();
  try {
    page.setDefaultTimeout(RENDER_TIMEOUT_MS);
    return await fn(page);
  } finally {
    await page.close().catch(() => {});
  }
}

async function setPageHtml(page: Page, html: string): Promise<void> {
  await page.setContent(wrapForRender(html), {
    waitUntil: renderWaitUntil(),
    timeout: RENDER_TIMEOUT_MS,
  });
}

export async function renderHtmlToPdfBuffer(browser: Browser, html: string): Promise<Buffer> {
  return withFreshPage(browser, async (page) => {
    await setPageHtml(page, html);
    const pdf = await withTimeout(
      page.pdf({
        format: "A4",
        printBackground: true,
        margin: { top: "12px", right: "12px", bottom: "12px", left: "12px" },
      }),
      "PDF render",
    );
    return Buffer.from(pdf);
  });
}

export async function renderHtmlToPngBuffer(browser: Browser, html: string): Promise<Buffer> {
  return withFreshPage(browser, async (page) => {
    await page.setViewport({ width: 816, height: 1056, deviceScaleFactor: 2 });
    await setPageHtml(page, html);
    const png = await withTimeout(
      page.screenshot({ type: "png", fullPage: true }),
      "PNG render",
    );
    return Buffer.from(png);
  });
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
  return withFreshPage(browser, async (page) => {
    await page.setViewport({ width: 816, height: 1056, deviceScaleFactor: 2 });
    await setPageHtml(page, html);
    const jpeg = await withTimeout(
      page.screenshot({
        type: "jpeg",
        quality,
        fullPage: true,
      }),
      "JPEG render",
    );
    return Buffer.from(jpeg);
  });
}

/** Limits concurrent Puppeteer renders (PDF/PNG) across SMTP workers. */
export function createRenderSemaphore(): {
  run<T>(fn: () => Promise<T>): Promise<T>;
  concurrency: number;
} {
  const concurrency = parsePositiveIntEnv("HTML_RENDER_CONCURRENCY", 4);
  let active = 0;
  const queue: Array<() => void> = [];

  function pump() {
    while (active < concurrency && queue.length > 0) {
      const next = queue.shift();
      if (next) next();
    }
  }

  return {
    concurrency,
    run<T>(fn: () => Promise<T>): Promise<T> {
      return new Promise<T>((resolve, reject) => {
        const start = () => {
          active += 1;
          fn()
            .then(resolve, reject)
            .finally(() => {
              active -= 1;
              pump();
            });
        };
        if (active < concurrency) start();
        else queue.push(start);
      });
    },
  };
}
