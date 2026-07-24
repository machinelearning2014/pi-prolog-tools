/**
 * EVO Web Tools — pi extension
 *
 * Ported from evo-ai/tools/web_browse.py and evo-ai/tools/web_search.py
 *
 * Registers two tools:
 * - web_browse: Fetch and extract text content from web pages
 * - web_search: Search the web via Brave, LangSearch, or DuckDuckGo HTML
 *
 * Usage: drop in ~/.pi/agent/extensions/ or .pi/extensions/ (auto-discovered)
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { browse, closeBrowser } from "./web-browse.js";
import { search } from "./web-search.js";

export default function (pi: ExtensionAPI) {
  // ── web_browse ────────────────────────────────────────────────────────────

  pi.registerTool({
    name: "web_browse",
    label: "Web Browse",
    description:
      "Fetch a web page and extract its text content using a headless browser. " +
      "Use this to read articles, documentation pages, or any URL that might " +
      "not be accessible via a simple HTTP request. Returns the page title, " +
      "URL, and extracted body text. Supports optional CSS selector for " +
      "targeted element extraction.",
    promptSnippet:
      "Fetch web page text content: web_browse { url: string, selector?: string }",
    parameters: Type.Object({
      url: Type.String({
        description: "The URL of the web page to fetch and extract text from",
      }),
      selector: Type.Optional(
        Type.String({
          description:
            "Optional CSS selector to extract only a specific element's text",
        })
      ),
    }),
    async execute(_toolCallId, params, _signal, _onUpdate, _ctx) {
      const { url, selector } = params as { url: string; selector?: string };

      if (!url || !url.trim()) {
        return {
          content: [
            { type: "text", text: "Error: URL is required for web_browse." },
          ],
          details: {},
        };
      }

      const result = await browse(url, selector || undefined);

      return {
        content: [
          {
            type: "text",
            text: result.success
              ? result.output
              : `Browse failed: ${result.error}`,
          },
        ],
        details: {
          success: result.success,
          error: result.error || undefined,
          statusCode: result.statusCode,
        },
      };
    },
  });

  // ── web_search ────────────────────────────────────────────────────────────

  pi.registerTool({
    name: "web_search",
    label: "Web Search",
    description:
      "Search the web for current information. Tries three backends in order: " +
      "Brave Search (via headless browser), LangSearch API (requires " +
      "LANGSEARCH_API_KEY env var), and DuckDuckGo HTML (no credentials needed). " +
      "Returns formatted results with titles, URLs, and snippets. When using " +
      "the Brave backend, also extracts content from each result page. " +
      "Use this to find current events, documentation, or any information " +
      "beyond your training cutoff.",
    promptSnippet:
      "Search the web: web_search { query: string, max_results?: number }",
    parameters: Type.Object({
      query: Type.String({
        description: "The search query string",
      }),
      max_results: Type.Optional(
        Type.Number({
          description: "Maximum number of results to return (1-5, default: 3)",
          minimum: 1,
          maximum: 5,
        })
      ),
    }),
    async execute(_toolCallId, params, _signal, _onUpdate, _ctx) {
      const { query, max_results } = params as {
        query: string;
        max_results?: number;
      };

      const result = await search(query, max_results ?? 3);

      return {
        content: [
          {
            type: "text",
            text: result.success
              ? result.output
              : `Search failed: ${result.error}`,
          },
        ],
        details: {
          success: result.success,
          error: result.error || undefined,
          source: result.source,
        },
      };
    },
  });

  // ── Cleanup ───────────────────────────────────────────────────────────────

  pi.on("session_shutdown", async () => {
    await closeBrowser();
  });
}
