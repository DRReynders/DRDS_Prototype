// Canonical Engineering Objects (Contracts V0.2).
// Informal structures by design — no schema validation layer (MVP Definition §3).

export type Confidence = "High" | "Medium-High" | "Medium" | "Low";

export type ResultStatus =
  | "Pass"
  | "Fail"
  | "Partial"
  | "Not Applicable"
  | "Not Assessed"
  | "Indeterminate"
  // Bounded Patch Area D. Stronger and more specific than Indeterminate: the
  // content this check looked for is delivered by a third-party embed that no
  // automated layer here can execute, so only a consumer browser (or a
  // screenshot) can settle it. On the iSmile rehearsal a Google Reviews widget
  // showing 343 reviews rendered normally in Chrome while static fetch, the
  // Phase 2 rendered fetch and an automated browser all reported it absent.
  // An absence in this state is a TOOLING LIMITATION, never a website defect.
  | "Requires Browser Confirmation";

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
  // Area D: third-party embed containers. Distinct from the markers above —
  // those hide content the site itself renders late, this one hides content a
  // different origin renders entirely. No amount of local rendering resolves it.
  embeds: number;
}

// Area D: which third-party embed families were found, so a downgrade can name
// the marker rather than gesture at "some widget". Counting only — no
// interpretation, and never evidence that the widget did or did not render.
export interface EmbedSignals {
  iframes: number;
  reviewWidgets: number; // elfsight, trustindex, embedsocial, featurable, reviewsonmywebsite
  mapEmbeds: number; // maps.google.com, google.com/maps/embed
  scriptEmbeds: number; // <script src> pointing at a known widget host
  markers: string[]; // bounded, e.g. ["elfsight", "maps.google.com"]
}

export const EMPTY_EMBED_SIGNALS: EmbedSignals = {
  iframes: 0,
  reviewWidgets: 0,
  mapEmbeds: 0,
  scriptEmbeds: 0,
  markers: [],
};

export function hasReviewOrMapEmbed(e: EmbedSignals): boolean {
  return e.reviewWidgets + e.mapEmbeds + e.scriptEmbeds + e.iframes > 0;
}

export interface PageImage {
  src: string;
  alt: string;
  lazy: boolean;
}

// Bounded Patch Area B: platform-neutral link/CTA inventory.
//
// The existing `links: string[]` is a crawl input — deduplicated absolute URLs,
// nothing else. It cannot answer conversion questions: which CTA, what it says,
// where it points, whether it points anywhere at all. On the iSmile rehearsal
// the header "WhatsApp Us" button carried href="" on all five pages and was
// invisible to every layer, because the crawl loop skips falsy hrefs and the
// rendered tool selected on Elementor classes the site does not use.
//
// PageLink is additive and deliberately dumb: it records what each anchor says
// and where it goes, and classifies the destination. It draws no conclusions —
// Area A consumes it to build Capture/Response evidence.
export type LinkType =
  | "whatsapp"
  | "tel"
  | "mailto"
  | "booking"
  | "social"
  | "internal"
  | "external"
  | "empty" // href present but blank — a control that goes nowhere
  | "anchor"; // same-page fragment

export interface PageLink {
  text: string; // visible anchor text; falls back to aria-label/title/img alt
  href: string; // raw href exactly as authored — "" is preserved, never dropped
  resolved: string; // absolute URL where resolvable; "" for empty/unparsable
  linkType: LinkType;
  external: boolean; // destination leaves the page's own host
  pageUrl: string; // the page the anchor was found on
  inNav: boolean; // sits inside nav/header/[role=navigation]
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
  // Area B: bounded anchor inventory, parallel to `links` and never a substitute
  // for it. Optional so every existing FetchedPage construction site stays valid
  // (same additive pattern as constraintSafety / verificationRequired).
  pageLinks?: PageLink[];
  // Area D: third-party embed markers found in this page's markup. Optional for
  // the same reason.
  embedSignals?: EmbedSignals;
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
  embeds: 0,
};

export function hasAnyDynamicSignal(s: DynamicSignals): boolean {
  return s.counters + s.lazyImages + s.galleries + s.tabs + s.accordions + s.carousels + s.embeds > 0;
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
