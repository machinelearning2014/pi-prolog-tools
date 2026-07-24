/**
 * Web Browse Tool — ported from evo-ai/tools/web_browse.py
 *
 * Uses Playwright headless Chromium to fetch and extract text from web pages.
 * Singleton browser instance shared across calls for efficiency.
 */

import { chromium, Browser, Page } from "playwright";

const DEFAULT_TIMEOUT_MS = 60_000;
const MAX_CONTENT_CHARS = 5000;
const PAGE_WAIT_MS = 2000;

let browser: Browser | null = null;
let browserRefs = 0;

async function getBrowser(): Promise<Browser> {
  if (!browser || !browser.isConnected()) {
    browser = await chromium.launch({
      headless: true,
      args: [
        "--no-sandbox",
        "--disable-setuid-sandbox",
        "--disable-dev-shm-usage",
        "--disable-accelerated-2d-canvas",
        "--no-first-run",
        "--no-zygote",
        "--disable-gpu",
      ],
    });
  }
  browserRefs++;
  return browser;
}

async function releaseBrowser(): Promise<void> {
  browserRefs = Math.max(0, browserRefs - 1);
  if (browserRefs === 0 && browser && browser.isConnected()) {
    await browser.close();
    browser = null;
  }
}

function contentIndicatesNotFound(bodyText: string): boolean {
  const stripped = (bodyText || "").trim();
  return stripped === "404: Not Found" || stripped === "Not Found";
}

export interface BrowseResult {
  success: boolean;
  output: string;
  error: string;
  statusCode?: number;
}

export async function browse(
  url: string,
  selector?: string,
  timeoutMs: number = DEFAULT_TIMEOUT_MS
): Promise<BrowseResult> {
  let page: Page | null = null;

  try {
    const browserInstance = await getBrowser();
    page = await browserInstance.newPage();

    const response = await page.goto(url, {
      timeout: timeoutMs,
      waitUntil: "domcontentloaded",
    });
    await page.waitForTimeout(PAGE_WAIT_MS);

    let output = `Web Page: ${url}\n\n`;
    output += `Title: ${await page.title()}\n\n`;

    // Optional CSS selector extraction
    if (selector) {
      try {
        const element = await page.$(selector);
        if (element) {
          const text = await element.textContent();
          output += `Selected Element (${selector}):\n${text}\n\n`;
        } else {
          output += `Selector "${selector}" not found\n\n`;
        }
      } catch (e: any) {
        output += `Error selecting "${selector}": ${e.message}\n\n`;
      }
    }

    // Extract body text
    const bodyText = await page.evaluate(() => {
      const scripts = document.querySelectorAll("script, style");
      scripts.forEach((s) => s.remove());

      const body = document.body;
      if (!body) return "";

      let text = (body as any).innerText || body.textContent || "";
      text = text.replace(/\n\s*\n/g, "\n\n");
      text = text.trim();
      return text.substring(0, 5000);
    });

    const status = response?.status();
    const strippedBody = (bodyText || "").trim();

    if (status && status >= 400) {
      return {
        success: false,
        output: output + `Content:\n${bodyText}\n`,
        error: `Browse failed: HTTP ${status}`,
        statusCode: status,
      };
    }

    if (contentIndicatesNotFound(strippedBody)) {
      return {
        success: false,
        output: output + `Content:\n${bodyText}\n`,
        error: "Browse failed: page content indicates not found",
      };
    }

    output += `Content:\n${bodyText}\n`;
    if (bodyText.length >= MAX_CONTENT_CHARS) {
      output += `\n... (content truncated to ${MAX_CONTENT_CHARS} characters)`;
    }

    return { success: true, output, error: "" };
  } catch (e: any) {
    return {
      success: false,
      output: "",
      error: `Browse failed: ${e.message || String(e)}`,
    };
  } finally {
    if (page && !page.isClosed()) {
      try {
        await page.close();
      } catch {
        // ignore close errors
      }
    }
    await releaseBrowser();
  }
}

/** Clean up the shared browser instance. Call on shutdown. */
export async function closeBrowser(): Promise<void> {
  if (browser && browser.isConnected()) {
    await browser.close();
    browser = null;
    browserRefs = 0;
  }
}
