// Real HTTP fetching — the only evidence-gathering method available in this
// prototype (no search API). Every page used by any stage passes through here.

import * as cheerio from "cheerio";
import type { FetchedPage } from "./types.js";

const USER_AGENT =
  "DRDS-GrowthSnapshot/0.1 (+https://drdigitalsystems.co.za; automated business growth diagnostic)";
const FETCH_TIMEOUT_MS = 20_000;
const MAX_TEXT_CHARS = 20_000;

// SSRF guard: this server fetches URLs submitted by strangers, so it must
// refuse anything that could reach internal/private infrastructure.
export function isForbiddenTarget(url: URL): string | null {
  if (url.protocol !== "http:" && url.protocol !== "https:") return "Only http/https URLs are supported.";
  if (url.port && url.port !== "80" && url.port !== "443") return "Non-standard ports are not supported.";
  const host = url.hostname.toLowerCase();
  const isPrivate =
    host === "localhost" ||
    host.endsWith(".local") ||
    host === "0.0.0.0" ||
    /^127\./.test(host) ||
    /^10\./.test(host) ||
    /^192\.168\./.test(host) ||
    /^172\.(1[6-9]|2\d|3[01])\./.test(host) ||
    /^169\.254\./.test(host) ||
    host === "::1" ||
    host.startsWith("fd") ||
    host.startsWith("fe80") ||
    host.startsWith("[");
  if (isPrivate) return "Private or local network addresses cannot be analysed.";
  return null;
}

export async function fetchPage(url: string): Promise<FetchedPage> {
  try {
    const forbidden = isForbiddenTarget(new URL(url));
    if (forbidden) {
      return {
        url, finalUrl: url, status: 0, html: "", text: "", title: "",
        metaDescription: "", h1s: [], links: [], fetchedAt: new Date().toISOString(),
        error: forbidden,
      };
    }
  } catch {
    /* unparsable URL falls through to the fetch error path below */
  }
  return fetchPageUnchecked(url);
}

async function fetchPageUnchecked(url: string): Promise<FetchedPage> {
  const fetchedAt = new Date().toISOString();
  try {
    const res = await fetch(url, {
      redirect: "follow",
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      headers: { "User-Agent": USER_AGENT, Accept: "text/html,*/*" },
    });
    const html = await res.text();
    const $ = cheerio.load(html);
    $("script, style, noscript").remove();

    const links: string[] = [];
    $("a[href]").each((_, el) => {
      const href = $(el).attr("href");
      if (!href) return;
      try {
        links.push(new URL(href, res.url).href);
      } catch {
        /* unparsable href — skip */
      }
    });

    const text = $("body").text().replace(/\s+/g, " ").trim().slice(0, MAX_TEXT_CHARS);

    return {
      url,
      finalUrl: res.url,
      status: res.status,
      html,
      text,
      title: $("title").first().text().trim(),
      metaDescription: $('meta[name="description"]').attr("content")?.trim() ?? "",
      h1s: $("h1")
        .map((_, el) => $(el).text().replace(/\s+/g, " ").trim())
        .get(),
      links: [...new Set(links)],
      fetchedAt,
    };
  } catch (err) {
    return {
      url,
      finalUrl: url,
      status: 0,
      html: "",
      text: "",
      title: "",
      metaDescription: "",
      h1s: [],
      links: [],
      fetchedAt,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

// robots.txt check — the top-level submitted URL is always fetched (it is the
// literal thing the user asked us to look at); deeper crawling respects robots.
// Minimal parser: only User-agent: * groups, only Disallow lines.
export async function getRobotsDisallows(origin: string): Promise<string[]> {
  try {
    const res = await fetch(`${origin}/robots.txt`, {
      signal: AbortSignal.timeout(10_000),
      headers: { "User-Agent": USER_AGENT },
    });
    if (!res.ok) return [];
    const body = await res.text();
    const disallows: string[] = [];
    let inStarGroup = false;
    for (const raw of body.split(/\r?\n/)) {
      const line = raw.replace(/#.*$/, "").trim();
      if (!line) continue;
      const [key, ...rest] = line.split(":");
      const value = rest.join(":").trim();
      if (key.toLowerCase() === "user-agent") {
        inStarGroup = value === "*";
      } else if (inStarGroup && key.toLowerCase() === "disallow" && value) {
        disallows.push(value);
      }
    }
    return disallows;
  } catch {
    return [];
  }
}

export function isAllowedByRobots(url: string, disallows: string[]): boolean {
  try {
    const path = new URL(url).pathname;
    return !disallows.some((rule) => path.startsWith(rule));
  } catch {
    return false;
  }
}
