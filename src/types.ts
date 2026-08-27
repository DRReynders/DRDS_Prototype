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

// Bounded Patch Area C1. Sector is derived from businessType in code — never a
// second LLM call — because it changes how a report may responsibly be worded.
// Run 001 classified a dental practice as "Other Professional Service" (the only
// option the taxonomy then offered) and consequently recommended toward patient
// testimonials, before/after imagery and outcome proof with no awareness that
// those are restricted categories for a regulated healthcare provider.
export type BusinessSector = "Healthcare" | "General";

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
  // Area C1 — derived, optional, additive. Absent on CIPs produced before this
  // patch, which stay valid.
  sector?: BusinessSector;
  // A REPORT-SAFETY FLAG ONLY. It marks areas where wording needs care and human
  // review. It is not legal advice, encodes no jurisdiction's rules, and makes no
  // determination about what the business may or may not lawfully do.
  regulatorSensitive?: boolean;
  regulatorSensitiveAreas?: string[];
}

// Bounded Patch Area C2. Renders the CIP's regulator-sensitive fields as prompt
// input for Contracts 4 and 5. The flag stays sourced from the CIP — it is never
// copied onto GoalModel or ReasoningResult — so there is exactly one place it can
// be wrong. Always returns a line, so the "General" case is stated rather than
// left as a silent gap the model has to interpret.
export function renderRegulatorContext(cip?: ClientIdentificationPacket): string {
  if (!cip?.regulatorSensitive) {
    return "Sector: General. No sector-specific wording constraints apply to this business.";
  }
  const areas = cip.regulatorSensitiveAreas?.length
    ? cip.regulatorSensitiveAreas.join("; ")
    : "patient testimonials; reviews; before/after imagery; case studies; outcomes; comparative claims; credentials";
  return [
    `Sector: ${cip.sector ?? "Healthcare"} (${cip.businessType}). THIS BUSINESS IS REGULATOR-SENSITIVE.`,
    `Compliance-sensitive recommendation areas: ${areas}.`,
    "Treat those areas as requiring compliance-aware wording and professional, legal or client review.",
  ].join("\n");
}

// Contract 2 — Goal Model
export interface GoalModel {
  businessGoal: string;
  expectedGrowthFunctions: string[];
  goalModelConfidence: Confidence;
  reasoningBasis: string;
}

// Patch 001.1 — claim polarity.
//
// The absence-safety rule exists to stop "we saw nothing" becoming "there is
// nothing" when the page renders content later. It decides which entries to
// protect by reading their wording, and that heuristic misfires: Run 002
// downgraded a correct finding — "10 dead (empty-href) anchor(s)" — because the
// word "empty" matched the absence pattern. Dead anchors are directly observed
// defects, not something that might be hiding behind JavaScript.
//
// A check knows what kind of claim it is making, so it should say so rather than
// leave a regex to guess:
//   "presence" — a defect or feature was directly observed and counted. Nothing
//                a renderer could reveal changes it, so it is never downgraded.
//   "absence"  — the check concluded something is missing. Always eligible for
//                the safety rule, whatever words it happens to use.
//   "mixed" / undefined — fall back to the wording heuristic, as before.
export type EvidenceClaimType = "presence" | "absence" | "mixed";

// Contract 3 — Evidence
// Public Snapshot projection support (Stage 1 of the observation boundary).
//
// The counted quantities a mechanical check already computed on its way to a
// Result Status. They exist so the public projection can compose owner-facing
// sentences from NUMBERS rather than by re-parsing the internal evidenceValue
// prose, which is written for the reasoning layer and carries its vocabulary.
//
// Numbers only, deliberately: a number cannot smuggle internal wording, a URL,
// or a model-authored phrase into public copy. Where a public sentence needs a
// place, it uses `source`, which is already a plain URL list.
export type EvidenceFacts = Readonly<Record<string, number>>;

export interface EvidenceEntry {
  evidenceId: string;
  growthFunction: string;
  evidenceType: string;
  evidenceValue: string;
  resultStatus: ResultStatus;
  source: string;
  evidenceAccessibility: EvidenceAccessibility;
  observation: string;
  // Optional and additive: entries produced before this patch, and every
  // LLM-authored entry, leave it undefined and keep the previous behaviour.
  claimType?: EvidenceClaimType;
  // Optional and additive, same pattern. Populated by the mechanical checks
  // only — an LLM-authored entry has no counted facts to report, and the
  // projection falls back to status-driven wording for those.
  facts?: EvidenceFacts;
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
  // Additive and optional — internal readers read named fields only.
  verificationRequired?: boolean;
}

// ─────────────────────────────────────────────────────────────────────────────
// PUBLIC SNAPSHOT PROJECTION — the free product's entire public contract.
//
// Product Council boundary, ratified:
//
//   The Growth Snapshot may state what is observably true.
//   Only the Growth Report may state what matters most.
//
// GrowthSnapshot above is now INTERNAL. It is the Contract 5 output, it stays
// in the run log, and the Growth Report assembler still reads it. It is no
// longer what a stranger receives.
//
// This projection is what a stranger receives. It is built only from Contract
// 0-3 output and factual run metadata (see src/projection/public-snapshot.ts).
// Every field below is observation-safe by construction:
//
//   · nothing here names a main, primary, single or biggest constraint;
//   · nothing here ranks two findings against each other;
//   · nothing here claims that fixing X produces outcome Y;
//   · nothing here prescribes an order of work or where to invest.
//
// The boundary is enforced by the BUILDER'S INPUT TYPE, not by wording. A later
// maintainer cannot leak a constraint by editing frontend copy, because no
// constraint ever reaches this object.
// ─────────────────────────────────────────────────────────────────────────────

/** One thing the published pages actually showed, with the counted detail that
 *  proves it and the pages it was read from.
 *
 *  `statement` is WHAT WE CAN SEE. `proof` is WHY WE THINK THIS. Neither may
 *  say that this observation matters more than any other, and neither may
 *  assert a consequence of acting on it. */
export interface PublicSignal {
  /** Owner-facing, plain language. Describes the site, never its importance. */
  statement: string;
  /** The counted, checkable detail behind the statement. */
  proof: string;
  /** The page(s) it was read from — the receipt for this one line. */
  source: string;
  /** Evidence Library id. Carried for internal traceability and for tests; the
   *  public surfaces never render it. */
  evidenceId: string;
}

/** A question the published pages could not responsibly answer, and why not.
 *
 *  `reason` always describes a limit of OUR method or access. It is never a
 *  defect of the website: "we could not see it" and "it is not there" are
 *  different findings and this product must not blur them. */
export interface PublicUnsettled {
  question: string;
  reason: string;
}

/** Proof the inspection genuinely happened, in checkable facts. */
export interface PublicReceipt {
  /** Final URLs actually fetched and read. */
  pagesInspected: string[];
  pagesInspectedCount: number;
  /** How many checks ran, and how many reached a conclusion. A count of
   *  activity and of certainty — never a score, and never a grade. */
  signalsChecked: number;
  signalsSettled: number;
  /** Pages we did NOT read because robots.txt asked us not to. Declaring them
   *  is the honest half of honouring the file. */
  notInspected: string[];
  /** Fixed, factual statements of what this method cannot see. */
  limitations: string[];
}

export interface PublicSnapshot {
  /** How the business presents itself, from its own pages. Identity only —
   *  never an assessment of the business. */
  businessRead: string;
  /** Observation-safe signals. Order is presentational and fixed by the
   *  Evidence Library's own declaration order; it carries no severity. */
  whatWeCanSee: PublicSignal[];
  /** Genuine visible strengths, held in a separate list so praise can never be
   *  inferred from the absence of a gap, or vice versa. */
  whatIsWorking: PublicSignal[];
  /** What public evidence cannot settle. */
  whatWeCouldNotSettle: PublicUnsettled[];
  /** Confidence in the EVIDENCE and its coverage. Explicitly NOT confidence in
   *  a selected constraint, because this product selects none. */
  evidenceConfidence: string;
  evidenceReceipt: PublicReceipt;
  /** Fixed, reviewed statement of what the free product does and does not do.
   *  Present in the payload rather than only in site copy, so every surface
   *  that renders a Snapshot carries the boundary with it. */
  boundaryNote: string;
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

// Patch 001.5 — escalation link inventory.
//
// Run 003's single escalation asked whether a service page's WhatsApp CTA used a
// working URI, and returned Indeterminate: "cannot be verified from text alone".
// It was right. Escalation is handed the page's visible TEXT, and an href is not
// text — the answer sat in the PageLink inventory the whole time, unread.
//
// Renders that inventory as compact lines the reasoning model can actually use.
// Ordered by conversion relevance and hard-bounded, because escalation shares a
// prompt with the page body and must not crowd it out.
const LINK_TYPE_RANK: Record<LinkType, number> = {
  empty: 0, // a control that goes nowhere is the most interesting thing here
  whatsapp: 1,
  booking: 2,
  tel: 3,
  mailto: 4,
  external: 6,
  social: 7,
  internal: 8,
  anchor: 9,
};
const MAX_INVENTORY_LINES = 40;
const MAX_URL_CHARS = 120;

export function renderPageLinkInventory(links: PageLink[], maxItems = MAX_INVENTORY_LINES): string {
  if (!links.length) return "";

  // Collapse exact repeats (the same nav anchor on desktop and mobile markup).
  const seen = new Set<string>();
  const unique: PageLink[] = [];
  for (const l of links) {
    const key = `${l.text}|${l.href}|${l.inNav}`;
    if (seen.has(key)) continue;
    seen.add(key);
    unique.push(l);
  }

  // One label reaching two destinations is a conversion defect on its own, so
  // those links are promoted regardless of type.
  const byLabel = new Map<string, Set<string>>();
  for (const l of unique) {
    const label = l.text.trim().toLowerCase();
    if (!label) continue;
    if (!byLabel.has(label)) byLabel.set(label, new Set());
    byLabel.get(label)!.add(l.resolved || l.href);
  }
  const conflicts = [...byLabel.entries()].filter(([, d]) => d.size > 1);
  const conflictLabels = new Set(conflicts.map(([label]) => label));

  const rankOf = (l: PageLink): number =>
    conflictLabels.has(l.text.trim().toLowerCase()) ? Math.min(LINK_TYPE_RANK[l.linkType], 5) : LINK_TYPE_RANK[l.linkType];

  const ordered = [...unique].sort((a, b) => rankOf(a) - rankOf(b));
  const shown = ordered.slice(0, maxItems);

  const trunc = (s: string): string => (s.length > MAX_URL_CHARS ? `${s.slice(0, MAX_URL_CHARS)}…` : s);
  const lines = shown.map((l) => {
    const where = l.inNav ? " (nav)" : "";
    const ext = l.external ? " (external)" : "";
    const dest = l.resolved || l.href;
    const target = l.linkType === "empty" ? 'href="" — leads nowhere' : `-> ${trunc(dest)}`;
    return `- [${l.linkType}]${where}${ext} "${l.text || "(no visible label)"}" ${target}`;
  });

  const conflictLines = conflicts
    .slice(0, 10)
    .map(([label, dests]) => `- "${label}" reaches ${dests.size} different destinations: ${[...dests].map(trunc).join("  |  ")}`);

  const pageUrl = links[0]?.pageUrl ?? "";
  const omitted = ordered.length - shown.length;

  return [
    `LINK INVENTORY (anchor targets read from the markup of ${pageUrl}; ${unique.length} distinct anchor(s)):`,
    ...lines,
    omitted > 0 ? `- … ${omitted} further link(s) omitted; the conversion-relevant ones are listed above.` : "",
    conflictLines.length ? `\nREPEATED LABELS WITH DIFFERENT DESTINATIONS:\n${conflictLines.join("\n")}` : "",
    `\nNote: hrefs above are read from markup, not followed. Nothing was opened, called, messaged or submitted.`,
  ]
    .filter(Boolean)
    .join("\n");
}

// Area A1: the static layer captured no form data at all, so "is there a way to
// contact this business" could not be answered mechanically. Markup-level only —
// presence, fields and their labels. Says nothing about whether the form works,
// validates, or delivers: none of that is observable without submitting one,
// which DRDS does not do.
export interface PageFormField {
  type: string; // input type attribute, or the tag name for textarea/select
  name: string;
  placeholder: string;
  required: boolean; // the HTML attribute only — builders often validate in JS
}

export interface PageForm {
  action: string; // "" when the builder handles submission in JavaScript
  method: string;
  fields: PageFormField[];
  pageUrl: string;
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
  // Area A1: bounded form inventory. Optional, same additive pattern.
  forms?: PageForm[];
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
  // What the visitor actually received. Built from the evidence layer alone and
  // recorded BEFORE the reasoning stages run, so the run log shows the public
  // product and the internal hypothesis as two separate, comparable things.
  publicSnapshot?: PublicSnapshot;
  reasoningResult?: ReasoningResult;
  // Internal only since the observation-boundary pass: Contract 5's output.
  // Still written, still read by the Growth Report assembler, never published.
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
  // The run could not produce its PUBLIC product. Nothing is delivered to the
  // visitor and the honest failure state is shown instead.
  failure?: { stage: string; reason: string };
  // Stage 1.1 — additive and optional.
  //
  // A failure that happened AFTER the public projection was already built, i.e.
  // in Contract 4 or Contract 5. The visitor still receives their Growth
  // Snapshot, because it was complete before this went wrong; only the internal
  // diagnostic work is missing.
  //
  // Deliberately a SEPARATE field from `failure` rather than a flag on it. The
  // two mean different things to every reader: `failure` means "no public
  // product", `internalFailure` means "public product delivered, Growth Report
  // raw material absent". Collapsing them is exactly the bug this patch fixes.
  internalFailure?: { stage: string; reason: string };
}
