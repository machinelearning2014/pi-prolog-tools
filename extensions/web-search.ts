/**
 * Web Search Tool — ported from evo-ai/tools/web_search.py
 *
 * Searches the web via three backends (in fallback order):
 * 1. Brave Search (Playwright scraping)
 * 2. LangSearch API (requires LANGSEARCH_API_KEY env var)
 * 3. DuckDuckGo HTML (no credentials needed)
 *
 * Optionally browses result pages for extracted content.
 */

import { chromium } from "playwright";
import { browse } from "./web-browse.js";

// ─── Constants ────────────────────────────────────────────────────────────────

const DEFAULT_TIMEOUT_S = 30;
const BROWSE_TIMEOUT_MS = 8000;
const LANGSEARCH_TIMEOUT_MS = 15_000;
const LANGSEARCH_ENDPOINT = "https://api.langsearch.com/v1/web-search";
const DUCKDUCKGO_HTML = "https://html.duckduckgo.com/html/";
const MAX_RESULTS = 5;
const MAX_EXTRACTED_CHARS = 1500;

// ─── Types ────────────────────────────────────────────────────────────────────

export interface SearchResultItem {
  title: string;
  url: string;
  snippet: string;
  summary?: string;
}

export interface SearchOutput {
  success: boolean;
  output: string;
  error: string;
  source?: string;
}

// ─── Brave search (Playwright scraping) ───────────────────────────────────────

const BRAVE_SEARCH_RESULT_SCRIPT = `(maxCount) => {
    const results = [];

    function normalizeUrl(href) {
        if (!href || !href.startsWith('http')) return '';
        try {
            const url = new URL(href);
            if (url.hostname.includes('brave.com') && url.searchParams.get('url')) {
                return url.searchParams.get('url');
            }
        } catch (_) {}
        return href;
    }

    function pushResult(title, href, snippet) {
        href = normalizeUrl(href);
        title = (title || '').trim();
        snippet = (snippet || '').trim();
        if (!href || !href.startsWith('http') || !title || title.length < 3) return;
        if (!results.find((result) => result.url === href)) {
            results.push({ title, snippet, url: href });
        }
    }

    const containers = Array.from(document.querySelectorAll(
        'div[data-type="web"], .snippet, .fdb, .card, article, li'
    ));

    for (const container of containers) {
        if (results.length >= maxCount) break;

        const titleElement = container.querySelector('h4, .title');
        const linkElement = container.querySelector('a[href^="http"]')
            || (titleElement ? titleElement.closest('a') : null);
        if (!titleElement || !linkElement) continue;

        const snippetElement = container.querySelector('.snippet-description, .snippet-content, [class*="description"]');
        pushResult(
            titleElement.textContent,
            linkElement.getAttribute('href'),
            snippetElement ? snippetElement.textContent : ''
        );
    }

    if (results.length < maxCount) {
        for (const link of Array.from(document.querySelectorAll('a[href^="http"]'))) {
            if (results.length >= maxCount) break;
            const title = (link.textContent || '').trim();
            const href = link.getAttribute('href');
            const parent = link.closest('div, article, li');
            const snippet = parent ? (parent.textContent || '').replace(title, '').trim() : '';
            pushResult(title, href, snippet);
        }
    }

    return results.slice(0, maxCount);
}`;

async function searchBrave(
  query: string,
  limit: number
): Promise<SearchResultItem[]> {
  const browser = await chromium.launch({
    headless: true,
    args: [
      "--no-sandbox",
      "--disable-setuid-sandbox",
      "--disable-dev-shm-usage",
      "--disable-accelerated-2d-canvas",
      "--no-first-run",
      "--no-zygote",
      "--single-process",
      "--disable-gpu",
    ],
  });

  const context = await browser.newContext({
    viewport: { width: 1920, height: 1080 },
    userAgent:
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 " +
      "(KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
    locale: "en-US",
    timezoneId: "America/New_York",
  });

  await context.addInitScript(`
    Object.defineProperty(navigator, 'webdriver', {
      get: () => undefined,
    });
    window.chrome = {
      runtime: {},
    };
    Object.defineProperty(navigator, 'plugins', {
      get: () => [1, 2, 3, 4, 5],
    });
    Object.defineProperty(navigator, 'languages', {
      get: () => ['en-US', 'en'],
    });
  `);

  const page = await context.newPage();
  try {
    const searchUrl = `https://search.brave.com/search?q=${encodeURIComponent(query.trim())}`;
    await page.goto(searchUrl, {
      waitUntil: "domcontentloaded",
      timeout: DEFAULT_TIMEOUT_S * 1000,
    });
    await page.waitForTimeout(2000);
    return await page.evaluate(BRAVE_SEARCH_RESULT_SCRIPT, limit);
  } finally {
    await page.close();
    await context.close();
    await browser.close();
  }
}

// ─── LangSearch API ───────────────────────────────────────────────────────────

function getLangSearchApiKey(): string {
  return process.env.LANGSEARCH_API_KEY || "";
}

async function searchLangSearch(
  query: string,
  limit: number
): Promise<SearchResultItem[]> {
  const apiKey = getLangSearchApiKey();
  if (!apiKey) {
    throw new Error("LANGSEARCH_API_KEY is not configured");
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), LANGSEARCH_TIMEOUT_MS);

  try {
    const response = await fetch(LANGSEARCH_ENDPOINT, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        query,
        freshness: "noLimit",
        summary: true,
        count: Math.min(Math.max(1, limit), 10),
      }),
      signal: controller.signal,
    });

    const data = await response.json();
    const pages = extractPages(data);

    const results: SearchResultItem[] = [];
    for (const page of pages.slice(0, limit)) {
      if (!page || typeof page !== "object") continue;
      const url = page.url || page.displayUrl || "";
      const title = page.name || page.title || url;
      const snippet = page.snippet || "";
      const summary = page.summary || "";
      if (!url) continue;
      results.push({ title, url, snippet, summary });
    }
    return results;
  } finally {
    clearTimeout(timeout);
  }
}

function extractPages(data: any): any[] {
  if (!data || typeof data !== "object") return [];

  const candidates = [
    data.webPages?.value,
    data.data,
    data.results,
    data.items,
  ];

  for (const candidate of candidates) {
    if (Array.isArray(candidate)) return candidate;
    if (candidate && typeof candidate === "object") {
      for (const key of ["webPages", "value", "results", "items", "data"]) {
        const nested = candidate[key];
        if (Array.isArray(nested)) return nested;
        if (nested && typeof nested === "object") {
          for (const nk of ["value", "results", "items", "data"]) {
            const nl = nested[nk];
            if (Array.isArray(nl)) return nl;
          }
        }
      }
    }
  }
  return [];
}

// ─── DuckDuckGo HTML fallback ─────────────────────────────────────────────────

async function searchDuckDuckGoHtml(
  query: string,
  limit: number
): Promise<SearchResultItem[]> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), DEFAULT_TIMEOUT_S * 1000);

  try {
    const response = await fetch(DUCKDUCKGO_HTML, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) " +
          "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120 Safari/537.36",
      },
      body: `q=${encodeURIComponent(query)}`,
      signal: controller.signal,
    });

    const html = await response.text();
    return parseDuckDuckGoHtml(html, limit);
  } finally {
    clearTimeout(timeout);
  }
}

function parseDuckDuckGoHtml(
  html: string,
  limit: number
): SearchResultItem[] {
  const results: SearchResultItem[] = [];

  // Try the structured result blocks first
  const blockRegex =
    /<div class="result(?: results_links_deep)?".*?<\/div>\s*<\/div>/gi;
  const blocks = html.match(blockRegex) || [];

  if (blocks.length === 0) {
    // Fallback: extract result__a links directly
    const linkRegex =
      /<a[^>]+class="result__a"[^>]+href="([^"]+)"[^>]*>(.*?)<\/a>/gi;
    let match;
    const seen = new Set<string>();
    while ((match = linkRegex.exec(html)) !== null) {
      if (results.length >= limit) break;
      const href = decodeDuckDuckGoUrl(match[1]);
      const title = stripTags(match[2]);
      if (isOrganicUrl(href) && title && !seen.has(href)) {
        seen.add(href);
        results.push({ title: unescapeHtml(title).trim(), url: href, snippet: "" });
      }
    }
    return results;
  }

  const seen = new Set<string>();
  for (const block of blocks) {
    if (results.length >= limit) break;

    const linkMatch = /<a[^>]+class="result__a"[^>]+href="([^"]+)"[^>]*>(.*?)<\/a>/i.exec(block);
    if (!linkMatch) continue;

    const href = linkMatch[1];
    const titleHtml = linkMatch[2];

    const snippetMatch =
      /<a[^>]+class="result__snippet"[^>]*>(.*?)<\/a>/i.exec(block) ||
      /<div[^>]+class="result__snippet"[^>]*>(.*?)<\/div>/i.exec(block);

    const snippetHtml = snippetMatch
      ? (snippetMatch[1] || snippetMatch[2] || "")
      : "";

    const title = unescapeHtml(stripTags(titleHtml)).trim();
    const snippet = unescapeHtml(stripTags(snippetHtml)).trim();
    const url = decodeDuckDuckGoUrl(href);

    if (isOrganicUrl(url) && title && !seen.has(url)) {
      seen.add(url);
      results.push({ title, url, snippet });
    }
  }

  return results;
}

function decodeDuckDuckGoUrl(href: string): string {
  href = unescapeHtml(href || "");
  if (href.startsWith("//")) href = "https:" + href;

  try {
    const parsed = new URL(href);
    if (parsed.pathname === "/l/") {
      const uddg = parsed.searchParams.get("uddg");
      if (uddg) return decodeURIComponent(uddg);
    }
  } catch {
    // not a valid URL, return as-is
  }
  return href;
}

function isOrganicUrl(url: string): boolean {
  if (!url || !url.startsWith("http")) return false;
  try {
    const parsed = new URL(url);
    const host = parsed.hostname.toLowerCase();
    const query = parsed.search.toLowerCase();
    if (host.endsWith("duckduckgo.com") && parsed.pathname.startsWith("/y.js"))
      return false;
    if (
      query.includes("ad_domain=") ||
      query.includes("ad_provider=") ||
      parsed.pathname.includes("aclick")
    )
      return false;
  } catch {
    return false;
  }
  return true;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function stripTags(html: string): string {
  return html.replace(/<[^>]+>/g, "");
}

function unescapeHtml(str: string): string {
  return str
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#x27;/g, "'")
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, " ");
}

function truncateContent(content: string): string {
  if (content.length <= MAX_EXTRACTED_CHARS) return content;
  return content.slice(0, MAX_EXTRACTED_CHARS) + "...\n[Content truncated]";
}

function extractBrowseContent(output: string): string {
  const marker = "Content:\n";
  const idx = output.indexOf(marker);
  if (idx !== -1) return output.slice(idx + marker.length).trim();
  return output.trim();
}

// ─── Main search orchestrator ─────────────────────────────────────────────────

export async function search(
  query: string,
  maxResults: number = 3,
  browseResults: boolean = true
): Promise<SearchOutput> {
  if (!query || !query.trim()) {
    return { success: false, output: "", error: "Search query cannot be empty." };
  }

  const limit = Math.min(Math.max(1, maxResults || 3), MAX_RESULTS);

  // Try backends in preferred order, stopping at first success
  const backends: Array<{
    name: string;
    fn: () => Promise<SearchResultItem[]>;
    includeBrowse: boolean;
  }> = [
    { name: "Brave", fn: () => searchBrave(query, limit), includeBrowse: true },
    { name: "LangSearch", fn: () => searchLangSearch(query, limit), includeBrowse: false },
    { name: "DuckDuckGo HTML", fn: () => searchDuckDuckGoHtml(query, limit), includeBrowse: false },
  ];

  const failures: string[] = [];

  for (const backend of backends) {
    try {
      const results = await backend.fn();
      if (results.length > 0) {
        const shouldBrowse = browseResults && backend.includeBrowse;
        return formatResults(query, results, backend.name, shouldBrowse);
      }
      failures.push(`${backend.name} returned no results.`);
    } catch (e: any) {
      failures.push(`${backend.name} failed: ${e.message || String(e)}`);
    }
  }

  return {
    success: false,
    output: "",
    error: "Search failed. " + failures.join(" "),
  };
}

async function formatResults(
  query: string,
  searchResults: SearchResultItem[],
  source: string,
  browseResults: boolean
): Promise<SearchOutput> {
  let output = "Web Search Results with Extracted Content\n";
  output += `${"=".repeat(80)}\n\n`;
  output += `Source: ${source}\n`;
  output += `Query: "${query}"\n`;
  output += `Results: ${searchResults.length}\n\n`;
  output += `${"=".repeat(80)}\n\n`;

  for (let i = 0; i < searchResults.length; i++) {
    const result = searchResults[i];
    const { title, url, snippet, summary } = result;

    output += `## Result ${i + 1}: ${title}\n`;
    output += `URL: ${url}\n\n`;
    if (snippet) {
      output += `**Search Snippet:**\n${snippet}\n\n`;
    }
    if (summary) {
      output += `**Search Summary:**\n${truncateContent(summary)}\n\n`;
    }

    if (browseResults) {
      const browseResult = await browse(url, undefined, BROWSE_TIMEOUT_MS);
      if (browseResult.success) {
        const content = extractBrowseContent(browseResult.output);
        output += `**Extracted Content:**\n${truncateContent(content)}\n\n`;
      } else {
        output +=
          "**Extracted Content:** Failed to extract " +
          `(${browseResult.error || "Unknown browse error"})\n\n`;
      }
    }

    output += `${"-".repeat(80)}\n\n`;
  }

  output += `${"=".repeat(80)}\n`;
  return { success: true, output, error: "", source };
}
