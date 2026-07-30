// Canonical Engineering Objects (Contracts V0.2).
// Informal structures by design — no schema validation layer (MVP Definition §3).

export type Confidence = "High" | "Medium-High" | "Medium" | "Low";

export type ResultStatus =
  | "Pass"
  | "Fail"
  | "Partial"
  | "Not Applicable"
  | "Not Assessed"
  | "Indeterminate";

export type EvidenceAccessibility =
  | "Publicly Observable"
  | "Client Access Required"
  | "Third-Party Tool Required";

// Contract 0 — Business Input
export interface BusinessInput {
  inputType: "Website URL";
  rawInputValue: string;
  normalisedBusinessIdentifier: string;
  normalisationStatus: "Success" | "Failed";
  normalisationNotes: string; // populated only when status is Failed
}

// Contract 1 — Client Identification Packet
export interface IdentityConflict {
  field: string;
  details: string;
}

export interface ClientIdentificationPacket {
  businessName: string;
  businessType: string; // fixed taxonomy, see prompts/cip-identification.txt
  primaryDigitalAsset: string;
  detectedDigitalAssets: string[];
  location: string;
  observedLanguages: string[];
  identificationConfidence: Confidence;
  identityConflicts: IdentityConflict[];
  notes: string;
}

// Contract 2 — Goal Model
export interface GoalModel {
  businessGoal: string;
  expectedGrowthFunctions: string[];
  goalModelConfidence: Confidence;
  reasoningBasis: string;
}

// Contract 3 — Evidence
export interface EvidenceEntry {
  evidenceId: string;
  growthFunction: string;
  evidenceType: string;
  evidenceValue: string;
  resultStatus: ResultStatus;
  source: string;
  evidenceAccessibility: EvidenceAccessibility;
  observation: string;
}

export interface EvidencePackage {
  entries: EvidenceEntry[];
  evidenceCoverage: string; // aggregate, plain language (Sprint 1A resolution)
}

// Contract 4 — Reasoning
export interface EvidenceReference {
  evidenceId: string;
  why: string;
}

export interface ReasoningResult {
  businessGoal: string; // carried forward from GoalModel, not re-derived
  expectedGrowthFunctions: string[]; // carried forward
  primaryConstraint: string;
  hypothesisConfidence: "High" | "Medium" | "Low";
  evidenceCoverage: string; // aggregate, inherited from EvidencePackage
  supportingEvidence: EvidenceReference[];
  contradictoryEvidence: EvidenceReference[]; // empty means "checked, found none"
  secondaryConstraints: string[];
  reasoningNotes: string; // internal / audit-only, never customer-facing
  // Set by the Contract 4 safety gate (Phase 1, P1-d) when the proposed
  // constraint could not be supported by evidence a direct fetch can stand
  // behind. Additive and optional — absent means the gate found nothing wrong.
  constraintSafety?: {
    status: "requires-rendered-verification";
    reason: string;
    droppedSupportingEvidence: string[];
  };
}

// Contract 5 — Growth Snapshot
export interface GrowthSnapshot {
  primaryConstraint: string;
  whatIsGoingWell: string;
  whyWeThinkThis: string;
  howFixingItWillHelp: string;
  nextSteps: string;
  confidencePlainLanguage: string; // never a number, percentage, or technical term
  // Phase 1.1: true when Contract 4 gated the constraint and this Snapshot is
  // the fixed "could not confirm" copy rather than a model-written finding.
  // Additive and optional — the web UI and email read named fields only.
  verificationRequired?: boolean;
}

// Markers in the static HTML that indicate content a direct fetch cannot see.
// Static fetch executes no JavaScript, so a counter that animates from 0, a
// lazy-loaded gallery, or a closed accordion all read as absent. These counts
// let the static layer declare its own blind spots rather than report silence
// as absence (Rendered Fetcher Phase 1, P1-a).
export interface DynamicSignals {
  counters: number; // data-to-value / elementor-counter-number / jQuery.numerator
  lazyImages: number; // loading="lazy" / data-src / srcset
  galleries: number; // gallery / lightbox / swiper-slide markers
  tabs: number;
  accordions: number;
  carousels: number;
}

export interface PageImage {
  src: string;
  alt: string;
  lazy: boolean;
}

// A fetched page — the raw material evidence checks work from.
export interface FetchedPage {
  url: string;
  finalUrl: string;
  status: number;
  html: string;
  text: string; // extracted visible text
  title: string;
  metaDescription: string;
  h1s: string[];
  links: string[]; // absolute URLs found on the page
  canonical: string; // rel="canonical" resolved absolute; "" when absent
  dynamicSignals: DynamicSignals;
  images: PageImage[]; // bounded inventory — static fetch sees markup, not pixels
  fetchedAt: string;
  error?: string;
}

export const EMPTY_DYNAMIC_SIGNALS: DynamicSignals = {
  counters: 0,
  lazyImages: 0,
  galleries: 0,
  tabs: 0,
  accordions: 0,
  carousels: 0,
};

export function hasAnyDynamicSignal(s: DynamicSignals): boolean {
  return s.counters + s.lazyImages + s.galleries + s.tabs + s.accordions + s.carousels > 0;
}

// Per-stage developer observability record (orchestrator-level only — the
// stages themselves are unaware of it).
export interface StageRecord {
  stage: string;
  status: "completed" | "failed";
  startedAt: string;
  durationMs: number;
  confidence?: string; // only where the Contract's Structure carries one
  detail?: string;
}

// Full run record written to runs/ as one flat JSON file per run.
export interface RunLog {
  runId: string;
  startedAt: string;
  finishedAt?: string;
  input: BusinessInput;
  cip?: ClientIdentificationPacket;
  goalModel?: GoalModel;
  evidencePackage?: EvidencePackage;
  reasoningResult?: ReasoningResult;
  growthSnapshot?: GrowthSnapshot;
  escalationTrace?: {
    attempted: boolean;
    evidenceSought?: string;
    urlFetched?: string;
    outcome?: string;
    confidenceBefore?: string;
    confidenceAfter?: string;
  };
  pagesFetched: { url: string; status: number; error?: string }[];
  stages: StageRecord[];
  robots?: { disallows: string[]; blockedUrls: string[] };
  llmUsage?: import("./llm/usage.js").LlmUsageSummary;
  emailDelivery?: { to: string; sentAt: string; provider: string; status: "sent" | "failed"; detail?: string };
  failure?: { stage: string; reason: string };
}
