// Contract 0 — Business Input.
// Promise: every supported input is normalised into a Business Identifier, or the
// failure is reported explicitly. Per the Validation Council clarification,
// "Success" requires the identifier to be syntactically valid AND resolve to a
// reachable business resource — so a real fetch happens here.

import { fetchPage } from "../fetcher.js";
import type { BusinessInput, FetchedPage } from "../types.js";

export interface Contract0Output {
  input: BusinessInput;
  homepage?: FetchedPage; // the reachability-confirming fetch, reused downstream
}

export async function runContract0(rawInputValue: string): Promise<Contract0Output> {
  const base: Omit<BusinessInput, "normalisedBusinessIdentifier" | "normalisationStatus" | "normalisationNotes"> = {
    inputType: "Website URL",
    rawInputValue,
  };

  const trimmed = rawInputValue.trim();
  if (!trimmed) {
    return {
      input: {
        ...base,
        normalisedBusinessIdentifier: "",
        normalisationStatus: "Failed",
        normalisationNotes: "Empty input — nothing to normalise.",
      },
    };
  }

  let url: URL;
  try {
    url = new URL(/^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`);
  } catch {
    return {
      input: {
        ...base,
        normalisedBusinessIdentifier: "",
        normalisationStatus: "Failed",
        normalisationNotes: `Input could not be parsed as a URL: "${trimmed}"`,
      },
    };
  }

  const identifier = url.hostname.replace(/^www\./i, "");

  // Reachability confirmation — a real fetch, not a syntactic check.
  const homepage = await fetchPage(url.href);
  if (homepage.error || homepage.status >= 500 || homepage.status === 0) {
    return {
      input: {
        ...base,
        normalisedBusinessIdentifier: identifier,
        normalisationStatus: "Failed",
        normalisationNotes: `Identifier is syntactically valid but did not resolve to a reachable resource: ${
          homepage.error ?? `HTTP ${homepage.status}`
        }`,
      },
    };
  }
  // 4xx (e.g. 403 bot-blocking) still proves something real answered at this
  // domain — reachable, but with a note downstream stages will see via page text
  // being empty. Blocked-fetch honesty is handled at the evidence stage.
  const notes =
    homepage.status >= 400
      ? `Reachable, but the site answered HTTP ${homepage.status} to an automated fetch — page content may be unavailable to this run.`
      : "";

  return {
    input: {
      ...base,
      normalisedBusinessIdentifier: identifier,
      normalisationStatus: "Success",
      normalisationNotes: notes,
    },
    homepage,
  };
}
