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
}

// Contract 5 — Growth Snapshot
export interface GrowthSnapshot {
  primaryConstraint: string;
  whatIsGoingWell: string;
  whyWeThinkThis: string;
  howFixingItWillHelp: string;
  nextSteps: string;
  confidencePlainLanguage: string; // never a number, percentage, or technical term
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
  fetchedAt: string;
  error?: string;
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
