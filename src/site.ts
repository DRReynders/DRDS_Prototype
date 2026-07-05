// Collects the small fixed corpus of pages the pipeline works from: the homepage
// plus a handful of likely-core internal pages (about / services / contact /
// testimonials / blog). The page *categories* are fixed here — this is how the
// fixed evidence checks get their raw material, not dynamic evidence selection.

import { fetchPage, getRobotsDisallows, isAllowedByRobots } from "./fetcher.js";
import type { FetchedPage } from "./types.js";

const CORE_PAGE_PATTERNS: RegExp[] = [
  /about/i,
  /service|what-we-do|practice|offering/i,
  /contact/i,
  /testimonial|review|client/i,
  /blog|news|article|insight|resource/i,
  /team|people|who-we-are/i,
];
const MAX_INTERNAL_PAGES = 6;

export interface SiteCorpus {
  homepage: FetchedPage;
  internalPages: FetchedPage[];
  robotsDisallows: string[];
  robotsBlockedUrls: string[]; // candidate pages we did NOT fetch, honestly recorded
  unfetchedCandidates: string[]; // discovered but beyond the page cap / not matched
}

// Canonical identity of a page, ignoring scheme (http/https), www-prefix, hash,
// and trailing slash — the same page must never be fetched (or sent to the LLM)
// twice under trivially different URLs.
export function canonicalKey(href: string): string {
  const u = new URL(href);
  const host = u.hostname.replace(/^www\./i, "").toLowerCase();
  const path = u.pathname.replace(/\/+$/, "") || "/";
  return `${host}${path}${u.search}`;
}

export async function collectSiteCorpus(homepage: FetchedPage): Promise<SiteCorpus> {
  const origin = new URL(homepage.finalUrl).origin;
  const host = new URL(homepage.finalUrl).hostname.replace(/^www\./i, "");
  const robotsDisallows = await getRobotsDisallows(origin);

  const internalLinks = homepage.links.filter((href) => {
    try {
      const u = new URL(href);
      return (
        u.hostname.replace(/^www\./i, "") === host &&
        u.pathname !== "/" &&
        !/\.(pdf|jpg|jpeg|png|gif|svg|zip|docx?)$/i.test(u.pathname)
      );
    } catch {
      return false;
    }
  });

  // Deduplicate by canonical identity, preferring the https variant, and never
  // re-fetch the homepage itself under another alias.
  const homepageKey = canonicalKey(homepage.finalUrl);
  const byKey = new Map<string, string>();
  for (const href of internalLinks) {
    const key = canonicalKey(href);
    if (key === homepageKey) continue;
    const existing = byKey.get(key);
    if (!existing || (href.startsWith("https://") && !existing.startsWith("https://"))) {
      byKey.set(key, href);
    }
  }
  const uniqueLinks = [...byKey.values()];

  const candidates = uniqueLinks.filter((href) =>
    CORE_PAGE_PATTERNS.some((p) => p.test(new URL(href).pathname))
  );

  const toFetch: string[] = [];
  const robotsBlockedUrls: string[] = [];
  for (const href of candidates) {
    if (toFetch.length >= MAX_INTERNAL_PAGES) break;
    if (isAllowedByRobots(href, robotsDisallows)) toFetch.push(href);
    else robotsBlockedUrls.push(href);
  }

  const internalPages: FetchedPage[] = [];
  for (const href of toFetch) {
    internalPages.push(await fetchPage(href)); // sequential, one at a time — deliberate
  }

  return {
    homepage,
    internalPages,
    robotsDisallows,
    robotsBlockedUrls,
    unfetchedCandidates: uniqueLinks.filter(
      (h) => !toFetch.includes(h) && !robotsBlockedUrls.includes(h)
    ),
  };
}

export function allPages(corpus: SiteCorpus): FetchedPage[] {
  return [corpus.homepage, ...corpus.internalPages].filter((p) => !p.error && p.status < 400);
}

// Plain-text rendering of the corpus for LLM prompts, with per-page attribution
// so findings can say where they were seen.
export function corpusAsText(corpus: SiteCorpus, maxCharsPerPage = 8000): string {
  return allPages(corpus)
    .map(
      (p) =>
        `===== PAGE: ${p.finalUrl} =====\nTITLE: ${p.title}\nMETA DESCRIPTION: ${p.metaDescription}\nH1: ${p.h1s.join(" | ")}\nBODY TEXT:\n${p.text.slice(0, maxCharsPerPage)}`
    )
    .join("\n\n");
}
