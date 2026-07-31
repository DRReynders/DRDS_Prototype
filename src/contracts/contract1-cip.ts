// Contract 1 — Client Identification (CIP).
// Promise: the same normalised identifier always produces the same CIP.
// Honest limitation of this run mode (no search API): identification works only
// from the business's own fetched pages — no cross-referencing against
// directories, social platforms, or professional registries, which the Sprint 1A
// paper exercises used. Cross-source Identity Conflicts are therefore mostly
// invisible here; only intra-site conflicts can be caught.

import { llmJson, loadPrompt } from "../llm/client.js";
import { corpusAsText, type SiteCorpus } from "../site.js";
import type { BusinessSector, ClientIdentificationPacket, Confidence } from "../types.js";

// --- Area C1: deterministic sector derivation ---

// The recommendation categories a report must not treat as ordinary marketing
// advice when the subject is a regulated healthcare provider. Every one of these
// is where Run 001's reasoning pointed, with no awareness of the sector.
//
// This list exists to route wording to human review. It is NOT legal advice, and
// it asserts nothing about what any business may lawfully publish.
export const REGULATOR_SENSITIVE_AREAS: readonly string[] = [
  "patient testimonials",
  "reviews and review-generation",
  "before/after imagery",
  "case studies",
  "treatment outcomes",
  "comparative/superlative claims",
  "success-rate claims",
  "credential and professional-registration display",
];

// Matches the Dental and Healthcare / Medical taxonomy options, plus the obvious
// near-misses a model might emit instead ("Dentist", "Medical Practice").
// Deliberately narrow: allied-health professions are NOT enumerated here. Widening
// this is a Product Council decision, not something to slip into a bounded patch.
// `\w*` on the stems that take suffixes — "orthodont" alone would not match
// "Orthodontic", because the trailing word boundary lands mid-word.
const HEALTHCARE_TYPE =
  /\b(dental|dentist\w*|orthodont\w*|healthcare|health\s*care|medical|medicine|clinic\w*)\b/i;

export function deriveSectorFields(businessType: string): Pick<
  ClientIdentificationPacket,
  "sector" | "regulatorSensitive" | "regulatorSensitiveAreas"
> {
  const isHealthcare = HEALTHCARE_TYPE.test(businessType ?? "");
  const sector: BusinessSector = isHealthcare ? "Healthcare" : "General";
  return {
    sector,
    regulatorSensitive: isHealthcare,
    // Only carried where it applies — a General business gets no empty array
    // rattling around its run log.
    ...(isHealthcare ? { regulatorSensitiveAreas: [...REGULATOR_SENSITIVE_AREAS] } : {}),
  };
}

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
    // Area C1: derived in code from the classification just returned. No second
    // model call, and the same businessType always yields the same fields.
    ...deriveSectorFields(res.businessType),
  };
}
