// Contract 1 — Client Identification (CIP).
// Promise: the same normalised identifier always produces the same CIP.
// Honest limitation of this run mode (no search API): identification works only
// from the business's own fetched pages — no cross-referencing against
// directories, social platforms, or professional registries, which the Sprint 1A
// paper exercises used. Cross-source Identity Conflicts are therefore mostly
// invisible here; only intra-site conflicts can be caught.

import { llmJson, loadPrompt } from "../llm/client.js";
import { corpusAsText, type SiteCorpus } from "../site.js";
import type { ClientIdentificationPacket, Confidence } from "../types.js";

interface CipLlmResponse {
  businessName: string;
  businessType: string;
  primaryDigitalAsset: string;
  detectedDigitalAssets: string[];
  location: string;
  observedLanguages: string[];
  identificationConfidence: Confidence;
  identityConflicts: { field: string; details: string }[];
  notes: string;
  cannotIdentify: boolean;
  cannotIdentifyReason?: string;
}

export class CannotIdentifyError extends Error {}

export async function runContract1(
  identifier: string,
  corpus: SiteCorpus
): Promise<ClientIdentificationPacket> {
  const pageContent = corpusAsText(corpus);
  if (!pageContent.trim()) {
    // Failure behaviour per the Canonical Objects doc: never a guessed CIP.
    throw new CannotIdentifyError(
      "No page content could be fetched for this site — cannot identify the business without inventing detail."
    );
  }

  const prompt = loadPrompt("cip-identification", {
    IDENTIFIER: identifier,
    PAGE_CONTENT: pageContent,
  });
  // "fast" tier: identification is extraction/classification over supplied
  // text, not open-ended reasoning. Which model serves this tier is config.
  const res = await llmJson<CipLlmResponse>(prompt, {
    stage: "Contract 1",
    promptName: "cip-identification",
    tier: "fast",
  });

  if (res.cannotIdentify) {
    throw new CannotIdentifyError(
      res.cannotIdentifyReason ?? "The fetched content did not support identifying one coherent business."
    );
  }

  const singleSourceNote =
    "Identification based solely on the business's own website (direct fetch — no independent sources available in this run).";

  // Code-enforced calibration cap (like the escalation cap, a hard limit in
  // code, not a prompt instruction alone): this run mode is always
  // single-source, so identification confidence may never exceed Medium-High.
  if (res.identificationConfidence === "High") {
    res.identificationConfidence = "Medium-High";
  }

  return {
    businessName: res.businessName,
    businessType: res.businessType,
    primaryDigitalAsset: res.primaryDigitalAsset || identifier,
    detectedDigitalAssets: res.detectedDigitalAssets ?? [],
    location: res.location,
    observedLanguages: res.observedLanguages ?? [],
    identificationConfidence: res.identificationConfidence,
    identityConflicts: res.identityConflicts ?? [],
    notes: [res.notes, singleSourceNote].filter(Boolean).join(" "),
  };
}
