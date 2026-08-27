// The public Growth Snapshot projection.
//
// Product Council boundary, ratified:
//
//   The Growth Snapshot may state what is observably true.
//   Only the Growth Report may state what matters most.
//
// THE BOUNDARY IS THIS MODULE'S INPUT TYPE. `buildPublicSnapshot` accepts
// Contract 0-3 output and factual run metadata, and nothing else. It cannot
// read a ReasoningResult, a GrowthSnapshot, a Primary Constraint or a
// confidence in one, because none of them is reachable from here. That is
// deliberate: the previous leak happened because ONE type served as the
// reasoning output, the wire payload and the frontend contract at once, so
// public copy could be corrected without the public DATA ever changing.
//
// Nothing in this file imports from ../contracts/contract4-reasoning.js or
// ../contracts/contract5-snapshot.js, and test/public-snapshot-boundary.ts
// fails if that ever changes.
//
// PROVIDER-NEUTRAL BY CONSTRUCTION. This projection is fully deterministic: no
// model call, no provider, no prompt. The same evidence always produces the
// same public Snapshot, and swapping the diagnostic runtime underneath changes
// nothing here. The public product is bound to evidence schemas DRDS owns, not
// to any vendor's output.

import { coverageCounts } from "../contracts/contract3-evidence.js";
import { FIXED_EVIDENCE_IDS } from "../evidence/checks.js";
import type {
  BusinessInput,
  ClientIdentificationPacket,
  EvidenceEntry,
  EvidenceFacts,
  EvidencePackage,
  PublicReceipt,
  PublicSignal,
  PublicSnapshot,
  PublicUnsettled,
  ResultStatus,
} from "../types.js";

// ─── Input ───────────────────────────────────────────────────────────────────

/** Everything the public projection is allowed to see. Observation and factual
 *  run metadata only — deliberately no goal inference, no reasoning, no
 *  constraint, no confidence in a constraint. */
export interface ObservationInput {
  readonly input: BusinessInput;
  readonly cip: ClientIdentificationPacket;
  readonly evidence: EvidencePackage;
  readonly pagesFetched: readonly { url: string; status: number; error?: string }[];
  readonly robots?: { readonly disallows: readonly string[]; readonly blockedUrls: readonly string[] };
}

// ─── Presentation limits ─────────────────────────────────────────────────────
//
// These exist to keep the page readable. They are NOT a judgement about which
// findings matter — see selectByLibraryOrder below for how the survivors are
// chosen, and why that rule carries no severity.
const MAX_SIGNALS = 3;
const MAX_STRENGTHS = 2;
const MAX_UNSETTLED = 3;
const MAX_IDENTITY_NOTES = 1;

/** Evidence gathered during Contract 4's Confidence Escalation. Excluded from
 *  the public projection on principle: an escalation is a fetch performed IN
 *  SERVICE OF a constraint hypothesis, so which page it read is already a
 *  product of judgement. Including it would import that judgement through the
 *  back door. Only ever present when projecting a stored run log. */
const ESCALATION_FUNCTION = "(escalation)";

const CONCLUDED: readonly ResultStatus[] = ["Pass", "Partial", "Fail"];

// ─── Small helpers ───────────────────────────────────────────────────────────

function n(facts: EvidenceFacts | undefined, key: string): number {
  const value = facts?.[key];
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

/** Verb agreement for a counted subject: "1 page carries" / "3 pages carry". */
function verb(value: number, singular: string, plural: string): string {
  return value === 1 ? singular : plural;
}

/** "1 page" / "3 pages". */
function count(value: number, noun: string, plural = `${noun}s`): string {
  return `${value} ${value === 1 ? noun : plural}`;
}

// ─── The public phrasebook ───────────────────────────────────────────────────
//
// One entry per Evidence Library item, holding the OWNER-FACING wording for
// that item. All public language lives here, in the projection layer, so the
// evidence layer keeps its own vocabulary and neither has to compromise.
//
// Two rules hold for every sentence below:
//
//   `statement` carries ONE idea and never says an observation matters more
//   than another, and never claims a consequence of acting on it.
//
//   `proof` may enumerate counted facts freely. Receipts are the point of this
//   product: a reader is meant to be able to check us. The old anti-enumeration
//   rule existed to stop a list of deficiencies masquerading as a diagnosis,
//   which is not a risk in output that diagnoses nothing.

interface Said {
  statement: string;
  proof: string;
}

type Bucket = "pass" | "partial" | "fail";

interface Phrase {
  /** What this check asked, in owner language. Used when it did not conclude. */
  question: string;
  /** Wording per concluded outcome. A missing bucket means the item is simply
   *  not published in that state, rather than forced into a sentence. */
  say: Partial<Record<Bucket, (f: EvidenceFacts | undefined) => Said>>;
  /** Fact-free wording, used when the entry carries no counted facts.
   *
   *  Two cases need this and both are real. A run log written before the
   *  `facts` field existed replays with none — and this projection must be
   *  runnable against stored history, or it cannot be validated without paying
   *  for fresh runs. And a check added later that forgets to emit facts would
   *  otherwise publish "0 pages" as though it were an observation.
   *
   *  Degrading to a less specific TRUE sentence is the honest failure mode;
   *  publishing a confident zero is not. */
  generic?: Partial<Record<Bucket, Said>>;
  /** Why this item can be structurally unanswerable from published pages. */
  unsettledReason?: string;
}

const READ_FROM_TEXT = "Read from the published text of the pages we read.";
const NOT_PROOF_OF_ABSENCE =
  "Not finding it in the published text does not mean a visitor never sees it.";
const COMPARED_ACROSS_PAGES = "Compared across the pages we read.";
const READ_FROM_LINKS = "Read from the links in the pages we read — nothing was opened, called, messaged or submitted.";
const READ_FROM_FORMS = "Read from the form markup. Nothing was filled in and nothing was submitted.";
const READ_FROM_HOMEPAGE_LINKS = "Read from the links on your homepage.";

const PHRASES: Record<string, Phrase> = {
  // ── Discoverability / Credibility, mechanical ──
  "E-VIS-016": {
    question: "whether your site loads over a secure connection",
    say: {
      pass: () => ({
        statement: "Your site loads over a secure connection.",
        proof: "The security certificate was accepted when we opened your homepage.",
      }),
      fail: () => ({
        statement: "Your site did not load cleanly over a secure connection when we opened it.",
        proof: "Opening your homepage over a secure connection did not complete normally.",
      }),
    },
  },

  "E-VIS-001": {
    question: "whether each of your pages carries its own page title",
    say: {
      pass: (f) => ({
        statement: `Each of the ${count(n(f, "pages"), "page")} we read carries its own distinct page title.`,
        proof: `${count(n(f, "pages"), "page")} read; none without a title, and no two the same.`,
      }),
      partial: (f) => ({
        statement: `Some of the ${count(n(f, "pages"), "page")} we read do not carry their own distinct page title.`,
        proof: `${n(f, "missing")} of ${n(f, "pages")} had no title${n(f, "duplicated") ? ", and some titles repeat across pages" : ""}.`,
      }),
      fail: (f) => ({
        statement: `None of the ${count(n(f, "pages"), "page")} we read carried a page title.`,
        proof: `${n(f, "missing")} of ${n(f, "pages")} pages had no title.`,
      }),
    },
    generic: {
      pass: { statement: "Every page we read carries its own distinct page title.", proof: COMPARED_ACROSS_PAGES },
      partial: { statement: "Not every page we read carries its own distinct page title.", proof: COMPARED_ACROSS_PAGES },
      fail: { statement: "The pages we read did not carry page titles.", proof: COMPARED_ACROSS_PAGES },
    },
  },

  "E-VIS-002": {
    question: "whether each of your pages carries its own page description",
    say: {
      pass: (f) => ({
        statement: `Each of the ${count(n(f, "pages"), "page")} we read carries its own distinct page description.`,
        proof: `${count(n(f, "pages"), "page")} read; none without a description, and no two the same.`,
      }),
      partial: (f) => ({
        statement: `Some of the ${count(n(f, "pages"), "page")} we read do not carry their own distinct page description.`,
        proof: `${n(f, "missing")} of ${n(f, "pages")} had no description${n(f, "duplicated") ? ", and some descriptions repeat across pages" : ""}.`,
      }),
      fail: (f) => ({
        statement: `None of the ${count(n(f, "pages"), "page")} we read carried a page description.`,
        proof: `${n(f, "missing")} of ${n(f, "pages")} pages had no description.`,
      }),
    },
    generic: {
      pass: { statement: "Every page we read carries its own distinct page description.", proof: COMPARED_ACROSS_PAGES },
      partial: { statement: "Not every page we read carries its own distinct page description.", proof: COMPARED_ACROSS_PAGES },
      fail: { statement: "The pages we read did not carry page descriptions.", proof: COMPARED_ACROSS_PAGES },
    },
  },

  "E-VIS-003": {
    question: "whether each of your pages carries a single main heading",
    say: {
      pass: (f) => ({
        statement: `Every one of the ${count(n(f, "pages"), "page")} we read carries exactly one main heading.`,
        proof: `${count(n(f, "pages"), "page")} read, each with a single main heading.`,
      }),
      partial: (f) => ({
        statement: `${count(n(f, "bad"), "page")} of the ${n(f, "pages")} we read ${verb(n(f, "bad"), "does", "do")} not carry exactly one main heading.`,
        proof: "Counted from the heading markup of each page we read.",
      }),
      fail: (f) => ({
        statement: `None of the ${count(n(f, "pages"), "page")} we read carried exactly one main heading.`,
        proof: "Counted from the heading markup of each page we read.",
      }),
    },
    generic: {
      pass: { statement: "Every page we read carries exactly one main heading.", proof: COMPARED_ACROSS_PAGES },
      partial: { statement: "Not every page we read carries exactly one main heading.", proof: COMPARED_ACROSS_PAGES },
      fail: { statement: "The pages we read did not carry a single main heading.", proof: COMPARED_ACROSS_PAGES },
    },
  },

  "E-VIS-041": {
    question: "which of the usual page types your homepage links to",
    say: {
      // One wording for all three outcomes: this check reports a count, and a
      // count is the same kind of fact whether it is high or low. Giving the
      // low case sharper language would be severity by the back door.
      pass: (f) => corePages(f),
      partial: (f) => corePages(f),
      fail: (f) => corePages(f),
    },
    generic: {
      pass: { statement: "Your homepage links to the usual page types we look for.", proof: READ_FROM_HOMEPAGE_LINKS },
      partial: { statement: "Your homepage links to some of the usual page types we look for.", proof: READ_FROM_HOMEPAGE_LINKS },
      fail: { statement: "We found few of the usual page types linked from your homepage.", proof: READ_FROM_HOMEPAGE_LINKS },
    },
  },

  // ── Capture / Response, mechanical ──
  "E-CON-101": {
    question: "whether every page offers a way to get in touch",
    say: {
      pass: (f) => ({
        statement: `Every one of the ${count(n(f, "pages"), "page")} we read carries at least one way to get in touch.`,
        proof: `${n(f, "pagesWithRoute")} of ${n(f, "pages")} pages carried a contact route, and no link led nowhere.`,
      }),
      partial: (f) => ({
        statement: `${n(f, "pagesWithRoute")} of the ${count(n(f, "pages"), "page")} we read ${verb(n(f, "pagesWithRoute"), "carries", "carry")} a way to get in touch.`,
        proof: n(f, "dead")
          ? `${count(n(f, "dead"), "link")} on those pages carr${n(f, "dead") === 1 ? "ies" : "y"} no destination and lead${n(f, "dead") === 1 ? "s" : ""} nowhere.`
          : `Counted from the contact links in the pages we read.`,
      }),
      fail: (f) => ({
        statement: `None of the ${count(n(f, "pages"), "page")} we read carried a way to get in touch that we could see.`,
        proof: `No phone, email, WhatsApp or booking link appeared in the pages we read. ${NOT_PROOF_OF_ABSENCE}`,
      }),
    },
    generic: {
      pass: { statement: "Every page we read carries at least one way to get in touch.", proof: READ_FROM_LINKS },
      partial: { statement: "Only some of the pages we read carry a way to get in touch.", proof: READ_FROM_LINKS },
      fail: {
        statement: "None of the pages we read carried a way to get in touch that we could see.",
        proof: `${READ_FROM_LINKS} ${NOT_PROOF_OF_ABSENCE}`,
      },
    },
  },

  "E-CON-102": {
    question: "where your contact links actually go",
    say: {
      pass: (f) => ({
        statement: `Your contact links point to ${count(n(f, "totalRoutes"), "destination")}, and each label goes to one place.`,
        proof: destinationProof(f),
      }),
      partial: (f) => ({
        statement: `Your contact links point to ${count(n(f, "totalRoutes"), "destination")}.`,
        proof: n(f, "conflicts")
          ? `${count(n(f, "conflicts"), "link label")} point${n(f, "conflicts") === 1 ? "s" : ""} to more than one different destination. ${destinationProof(f)}`
          : destinationProof(f),
      }),
      fail: () => ({
        statement: "We found no contact destination in the links on the pages we read.",
        proof: `Link targets were read from the markup, not followed. ${NOT_PROOF_OF_ABSENCE}`,
      }),
    },
    generic: {
      pass: { statement: "Your contact links point to a consistent set of destinations.", proof: READ_FROM_LINKS },
      partial: { statement: "Your contact links do not all point to a consistent set of destinations.", proof: READ_FROM_LINKS },
      fail: {
        statement: "We found no contact destination in the links on the pages we read.",
        proof: `${READ_FROM_LINKS} ${NOT_PROOF_OF_ABSENCE}`,
      },
    },
  },

  "E-CON-103": {
    question: "whether your pages carry a contact form",
    say: {
      pass: (f) => ({
        statement: `Your pages carry ${count(n(f, "forms"), "form")}, ${n(f, "substantive")} of them with more than one field.`,
        proof: "Read from the form markup. Nothing was filled in and nothing was submitted.",
      }),
      partial: (f) => ({
        statement: `Your pages carry ${count(n(f, "forms"), "form")}, none with more than one visible field.`,
        proof: "Read from the form markup. Nothing was filled in and nothing was submitted.",
      }),
      fail: () => ({
        statement: "We found no form in the pages we read.",
        proof: `Forms are often added by page builders once a browser loads. ${NOT_PROOF_OF_ABSENCE}`,
      }),
    },
    generic: {
      pass: { statement: "Your pages carry a contact form with more than one field.", proof: READ_FROM_FORMS },
      partial: { statement: "Your pages carry a form, but none with more than one visible field.", proof: READ_FROM_FORMS },
      fail: {
        statement: "We found no form in the pages we read.",
        proof: `${READ_FROM_FORMS} ${NOT_PROOF_OF_ABSENCE}`,
      },
    },
  },

  "E-RES-101": {
    question: "whether your pages say when someone will hear back",
    say: {
      pass: (f) => ({
        statement: `Your pages say when someone will hear back, alongside ${count(n(f, "channels"), "way")} to make contact.`,
        proof: `Wording about replying appeared on ${count(n(f, "promisePages"), "page")} we read.`,
      }),
      partial: (f) =>
        n(f, "promisePages")
          ? {
              statement: "Your pages say when someone will hear back.",
              proof: `Wording about replying appeared on ${count(n(f, "promisePages"), "page")} we read.`,
            }
          : {
              statement: `Your pages offer ${count(n(f, "channels"), "way")} to make contact.`,
              proof: `We did not find wording about when someone will hear back. ${NOT_PROOF_OF_ABSENCE}`,
            },
    },
    generic: {
      pass: {
        statement: "Your pages say when someone will hear back, alongside more than one way to make contact.",
        proof: READ_FROM_TEXT,
      },
      partial: { statement: "Your pages offer a way to make contact.", proof: READ_FROM_TEXT },
    },
  },

  // ── Textual checks (LLM-read; no counted facts, so wording is status-driven) ──
  "E-VIS-004": {
    question: "whether your name, address and phone number match on every page",
    say: {
      pass: () => ({
        statement: "Your name, address and phone number read the same way on every page we read.",
        proof: "Compared across the pages we read. We cannot compare them against directory or map listings.",
      }),
      partial: () => ({
        statement: "Your name, address or phone number is not stated the same way on every page we read.",
        proof: "Compared across the pages we read. We cannot compare them against directory or map listings.",
      }),
      fail: () => ({
        statement: "Your name, address or phone number is not stated the same way on every page we read.",
        proof: "Compared across the pages we read. We cannot compare them against directory or map listings.",
      }),
    },
  },

  "E-VIS-027": {
    question: "whether third-party recognition appears on your pages",
    say: {
      pass: () => ({
        statement: "Your pages show recognition from outside your own business.",
        proof: READ_FROM_TEXT,
      }),
      partial: () => ({
        statement: "Recognition from outside your own business appears on some of the pages we read.",
        proof: READ_FROM_TEXT,
      }),
      fail: () => ({
        statement: "We did not find recognition from outside your own business in the pages we read.",
        proof: `${READ_FROM_TEXT} ${NOT_PROOF_OF_ABSENCE}`,
      }),
    },
    unsettledReason:
      "Recognition of this kind is often shown through a widget supplied by another site, which we cannot read.",
  },

  "E-CON-017": {
    question: "whether customer testimonials appear on your own pages",
    say: {
      pass: () => ({ statement: "Customer testimonials appear on your pages.", proof: READ_FROM_TEXT }),
      partial: () => ({
        statement: "Customer testimonials appear on some of the pages we read.",
        proof: READ_FROM_TEXT,
      }),
      fail: () => ({
        statement: "We did not find customer testimonials in the pages we read.",
        proof: `${READ_FROM_TEXT} ${NOT_PROOF_OF_ABSENCE}`,
      }),
    },
    unsettledReason:
      "Testimonials and reviews are often shown through a widget supplied by another site, which we cannot read.",
  },

  "E-CON-018": {
    question: "whether your pages show worked examples or proof of results",
    say: {
      pass: () => ({
        statement: "Your pages show worked examples or proof of past results.",
        proof: READ_FROM_TEXT,
      }),
      partial: () => ({
        statement: "Worked examples or proof of past results appear on some of the pages we read.",
        proof: READ_FROM_TEXT,
      }),
      fail: () => ({
        statement: "We did not find worked examples or proof of past results in the pages we read.",
        proof: `${READ_FROM_TEXT} ${NOT_PROOF_OF_ABSENCE}`,
      }),
    },
  },

  "E-SCA-001": {
    question: "whether your pages describe how you keep working with clients over time",
    say: {
      pass: () => ({
        statement: "Your pages describe how you keep working with clients over time.",
        proof: `${READ_FROM_TEXT} We can see that it is described, not whether it happens.`,
      }),
      fail: () => ({
        statement: "We did not find a description of how you keep working with clients over time.",
        proof: `${READ_FROM_TEXT} ${NOT_PROOF_OF_ABSENCE}`,
      }),
    },
    unsettledReason:
      "This is something a business describes about itself, so a published page can show the claim but never settle it.",
  },

  // ── Structurally unreachable in this run mode ──
  "E-VIS-018": {
    question: "whether your Google Business Profile is claimed and active",
    say: {},
    unsettledReason:
      "We read published web pages only, and have no way to reach Google Business Profile, map or local-search surfaces.",
  },
  "E-VIS-037": {
    question: "whether your Google Business Profile is verified",
    say: {},
    unsettledReason:
      "We read published web pages only, and have no way to reach Google Business Profile, map or local-search surfaces.",
  },
  "E-VIS-020": {
    question: "how many recent reviews your Google Business Profile carries",
    say: {},
    unsettledReason:
      "We read published web pages only, and have no way to reach Google Business Profile, map or local-search surfaces.",
  },
};

function corePages(f: EvidenceFacts | undefined): Said {
  return {
    statement: `Your homepage links to ${n(f, "found")} of the ${n(f, "wanted")} page types we look for.`,
    proof:
      "Read from the links on your homepage. Pages reached only from deeper navigation, or named in a way we did not recognise, would not be counted here.",
  };
}

function destinationProof(f: EvidenceFacts | undefined): string {
  const parts = [
    n(f, "whatsapp") ? count(n(f, "whatsapp"), "WhatsApp destination") : "",
    n(f, "booking") ? count(n(f, "booking"), "booking destination") : "",
    n(f, "tel") ? count(n(f, "tel"), "phone destination") : "",
    n(f, "mailto") ? count(n(f, "mailto"), "email destination") : "",
  ].filter(Boolean);
  const found = parts.length ? `${parts.join(", ")}. ` : "";
  return `${found}Read from the link targets in your pages — nothing was opened, called, messaged or submitted.`;
}

// ─── Unsettled reasons by status ─────────────────────────────────────────────

function unsettledReason(entry: EvidenceEntry, phrase: Phrase): string {
  switch (entry.resultStatus) {
    case "Requires Browser Confirmation":
      return (
        "This part of your page is drawn in by a third-party service from somewhere else. " +
        "We cannot read it, so its absence here is a limit of our reading, not of your site."
      );
    case "Indeterminate":
      return (
        "Your pages carry content that only appears once a browser has finished loading them, " +
        "and we do not run that step."
      );
    default:
      return phrase.unsettledReason ?? "We had no way to check this from published pages in this run.";
  }
}

// ─── Selection ───────────────────────────────────────────────────────────────
//
// THE SELECTION RULE, stated in full because it is a product decision and not
// an implementation detail:
//
//   1. Only checks that CONCLUDED (Pass, Partial, Fail) may be stated at all.
//      Everything else becomes an open question instead.
//   2. Concluded checks split by POLARITY, not severity: Pass goes to
//      "what is working", Partial and Fail go to "what we can see". Nothing
//      compares a Partial against a Fail, and nothing scores either.
//   3. Survivors are ordered by their position in the Evidence Library's own
//      declaration order (FIXED_EVIDENCE_IDS). That order was fixed long
//      before this product existed and carries no view about which growth
//      function matters — which is exactly why it is safe to sort by.
//   4. Survivors are taken round-robin across growth functions, so no single
//      area can fill the list and read as an emphasis. Within a function the
//      next item is whichever the library declares next — not the worst result.
//   5. Caps are applied last, in that same order.
//
// The rule exists to make the output readable. It must never be extended into
// a scoring engine: the moment "which of these do we show" starts depending on
// how bad a result is, this product has begun ranking business priority, which
// is the Growth Report's job.

const LIBRARY_ORDER = new Map(FIXED_EVIDENCE_IDS.map((id, index) => [id, index]));

function libraryIndex(entry: EvidenceEntry): number {
  return LIBRARY_ORDER.get(entry.evidenceId) ?? Number.MAX_SAFE_INTEGER;
}

/** Composite labels ("Discoverability / Credibility") key on their first
 *  segment, so the diversity rule stays deterministic. */
function functionKey(entry: EvidenceEntry): string {
  return entry.growthFunction.split("/")[0].trim();
}

function selectByLibraryOrder(entries: EvidenceEntry[], cap: number): EvidenceEntry[] {
  const ordered = [...entries].sort((a, b) => libraryIndex(a) - libraryIndex(b));

  // Round-robin over growth functions, in library order within each. The first
  // pass takes one item per function so no single area can fill the list; if
  // that leaves room under the cap, the second pass takes each function's next
  // item, and so on.
  //
  // A single pass was tried first and read too thin: on a real replayed run all
  // the concluded gaps sat in one growth function, so the visitor saw exactly
  // one observation and the page looked like we had barely looked. Filling the
  // remaining slots from the same function is not a severity judgement — the
  // survivor is still whichever item the Evidence Library happens to declare
  // next, which is arbitrary with respect to business importance.
  const byFunction = new Map<string, EvidenceEntry[]>();
  for (const entry of ordered) {
    const key = functionKey(entry);
    if (!byFunction.has(key)) byFunction.set(key, []);
    byFunction.get(key)!.push(entry);
  }

  const queues = [...byFunction.values()];
  const kept: EvidenceEntry[] = [];
  for (let round = 0; kept.length < cap; round++) {
    let tookAny = false;
    for (const queue of queues) {
      if (round >= queue.length) continue;
      kept.push(queue[round]);
      tookAny = true;
      if (kept.length >= cap) break;
    }
    if (!tookAny) break;
  }
  return kept;
}

function toSignal(entry: EvidenceEntry, bucket: Bucket): PublicSignal | null {
  const phrase = PHRASES[entry.evidenceId];
  if (!phrase) return null;
  // With counted facts, the specific sentence. Without them, the fact-free one.
  // Never the specific sentence with zeros substituted in: "0 pages" reads as an
  // observation and would be a lie about what we looked at.
  const said = entry.facts ? phrase.say[bucket]?.(entry.facts) : phrase.generic?.[bucket] ?? phrase.say[bucket]?.(undefined);
  if (!said) return null;
  return {
    statement: said.statement,
    proof: said.proof,
    source: entry.source,
    evidenceId: entry.evidenceId,
  };
}

// ─── Business read ───────────────────────────────────────────────────────────

// Deterministic map from the fixed CIP taxonomy to owner-facing English. The
// two "Other" options map to nothing on purpose: "an other professional service
// business" is worse than saying nothing at all.
const TYPE_PHRASE: Record<string, string> = {
  "Financial Advisory": "a financial advisory practice",
  Legal: "a legal practice",
  Accounting: "an accounting practice",
  Consulting: "a consulting business",
  Dental: "a dental practice",
  "Healthcare / Medical": "a healthcare practice",
};

/** The CIP's location is free text and may itself be an honest refusal ("not
 *  stated on the site"). Splicing that into a sentence produces nonsense, so
 *  anything that reads like a non-answer is dropped rather than rendered. */
const NON_LOCATION = /\b(not (stated|specified|given|found|listed)|none|unclear|unknown|multiple|n\/?a)\b/i;

function looksLikeRealLocation(location: string): boolean {
  const trimmed = location.trim();
  return trimmed.length > 0 && trimmed.length <= 80 && !NON_LOCATION.test(trimmed);
}

function businessRead(cip: ClientIdentificationPacket, input: BusinessInput): string {
  const name = cip.businessName?.trim() || input.normalisedBusinessIdentifier;
  const type = TYPE_PHRASE[cip.businessType?.trim() ?? ""];
  const location = looksLikeRealLocation(cip.location ?? "") ? cip.location.trim() : "";
  const clauses = [type, location ? `based in ${location}` : ""].filter(Boolean).join(", ");
  return clauses
    ? `Your public pages present the business as ${name}, ${clauses}.`
    : `Your public pages present the business as ${name}.`;
}

/** An identity discrepancy is a direct observation about the business rather
 *  than a check result, so it is listed before the check-derived signals. That
 *  ordering is structural — a different KIND of observation — and says nothing
 *  about which matters more. Only the field name is used: the CIP's `details`
 *  is model-authored free text and never reaches a public surface. */
function identitySignals(cip: ClientIdentificationPacket): PublicSignal[] {
  return (cip.identityConflicts ?? []).slice(0, MAX_IDENTITY_NOTES).map((conflict) => ({
    statement: `Your ${conflict.field.toLowerCase()} is not stated the same way on every page we read.`,
    proof: "Compared across the pages we read.",
    source: cip.primaryDigitalAsset,
    evidenceId: "CIP-CONFLICT",
  }));
}

// ─── Confidence and receipt ──────────────────────────────────────────────────

function evidenceConfidence(settled: number, checked: number, label: string): string {
  const base = `We settled ${settled} of the ${checked} things we looked at.`;
  switch (label) {
    case "Substantial":
      return `${base} That is a solid base of public evidence for describing what your pages show — and it is still only what is public.`;
    case "Partial":
      return `${base} Enough stayed open that this is a partial view of your public evidence, not a complete one.`;
    default:
      return `${base} Public evidence was thin on this site, so there is little here we can state with confidence.`;
  }
}

function limitations(
  entries: EvidenceEntry[],
  robots: ObservationInput["robots"]
): string[] {
  const lines = [
    "We read published pages only. Nothing private was opened, no form was submitted, and no phone, email or messaging route was used.",
    "We do not run the scripts a browser runs, so anything that appears only after a page finishes loading is invisible to us.",
  ];
  const gbpUnreachable = entries.some(
    (e) => e.resultStatus === "Not Assessed" && PHRASES[e.evidenceId]?.question.includes("Google Business Profile")
  );
  if (gbpUnreachable) {
    lines.push(
      "We cannot see Google Business Profile, map or local-search surfaces, so nothing here describes how findable this business is."
    );
  }
  if (entries.some((e) => e.resultStatus === "Requires Browser Confirmation")) {
    lines.push(
      "Some of your content is drawn in by third-party services from elsewhere. We cannot read those, and their absence here is a limit of our reading, not of your site."
    );
  }
  const blocked = robots?.blockedUrls?.length ?? 0;
  if (blocked > 0) {
    lines.push(
      `${count(blocked, "page")} went unread because your robots.txt asks automated readers not to open ${blocked === 1 ? "it" : "them"}.`
    );
  }
  return lines;
}

// ─── Fixed public copy ───────────────────────────────────────────────────────

/** Carried in the payload, not only in site copy, so every surface that renders
 *  a Snapshot carries the boundary with it — including the email, which no page
 *  copy reaches. */
export const BOUNDARY_NOTE =
  "This is an observation of what your public pages show. It does not decide which of these matters most, " +
  "and it does not set an order of work. That judgement is the Growth Report.";

const NOTHING_CONCLUDED =
  "Nothing we looked at settled cleanly enough on this site for us to state it here.";
const NO_STRENGTH_CONCLUDED =
  "Nothing we looked at settled cleanly enough on this site for us to point to it as a strength. That is a limit of what we could read, not a verdict on your business.";
const NOTHING_UNSETTLED =
  "Everything we looked at reached a conclusion in this run.";

// ─── The projection ──────────────────────────────────────────────────────────

export function buildPublicSnapshot(observed: ObservationInput): PublicSnapshot {
  const eligible = observed.evidence.entries.filter(
    (e) => e.growthFunction !== ESCALATION_FUNCTION && PHRASES[e.evidenceId] !== undefined
  );

  const concluded = eligible.filter((e) => CONCLUDED.includes(e.resultStatus));
  const unresolved = eligible.filter((e) => !CONCLUDED.includes(e.resultStatus));

  const gaps = concluded.filter((e) => e.resultStatus !== "Pass");
  const strengths = concluded.filter((e) => e.resultStatus === "Pass");

  const identity = identitySignals(observed.cip);
  const checkSignals = selectByLibraryOrder(gaps, MAX_SIGNALS)
    .map((e) => toSignal(e, e.resultStatus === "Fail" ? "fail" : "partial"))
    .filter((x): x is PublicSignal => x !== null);
  const strengthSignals = selectByLibraryOrder(strengths, MAX_STRENGTHS)
    .map((e) => toSignal(e, "pass"))
    .filter((x): x is PublicSignal => x !== null);

  // Open questions dedupe by REASON, not by growth function: three separate
  // Google Business Profile items blocked by one missing method are one honest
  // line to a reader, not three.
  const byReason = new Map<string, PublicUnsettled>();
  for (const entry of [...unresolved].sort((a, b) => libraryIndex(a) - libraryIndex(b))) {
    const phrase = PHRASES[entry.evidenceId];
    const reason = unsettledReason(entry, phrase);
    if (byReason.has(reason)) continue;
    byReason.set(reason, { question: phrase.question, reason });
  }
  const unsettled = [...byReason.values()].slice(0, MAX_UNSETTLED);

  const coverage = coverageCounts(observed.evidence.entries);
  const inspected = observed.pagesFetched
    .filter((p) => !p.error && p.status > 0 && p.status < 400)
    .map((p) => p.url);

  const receipt: PublicReceipt = {
    pagesInspected: inspected,
    pagesInspectedCount: inspected.length,
    signalsChecked: coverage.total,
    signalsSettled: coverage.usable,
    notInspected: [...(observed.robots?.blockedUrls ?? [])],
    limitations: limitations(observed.evidence.entries, observed.robots),
  };

  return {
    businessRead: businessRead(observed.cip, observed.input),
    whatWeCanSee: [...identity, ...checkSignals],
    whatIsWorking: strengthSignals,
    whatWeCouldNotSettle: unsettled,
    evidenceConfidence: evidenceConfidence(coverage.usable, coverage.total, coverage.label),
    evidenceReceipt: receipt,
    boundaryNote: BOUNDARY_NOTE,
  };
}

/** Fallback copy for a list that came back empty. Exported so every surface
 *  renders the same sentence rather than inventing its own, and so a test can
 *  assert those sentences carry no judgement either. */
export const EMPTY_STATE = {
  whatWeCanSee: NOTHING_CONCLUDED,
  whatIsWorking: NO_STRENGTH_CONCLUDED,
  whatWeCouldNotSettle: NOTHING_UNSETTLED,
} as const;
