// The public commercial facts, as the backend sees them.
//
// This module OWNS NOTHING. It is a typed read of `product.json` at the
// repository root — the one place a public price is written down — so that a
// backend surface and the Astro site cannot quote a visitor two different
// numbers. The site reads the same file directly; neither tree imports the
// other's source, which is the isolation `website/package.json` describes.
//
// Deliberately not configuration: there is no environment variable here and
// there must not be. A price that varies by deploy is a price no one can quote,
// and this value appears in an email that leaves the building.
//
// `product.json` holds DATA AND NOTHING ELSE — no comment key, no notes, no
// rationale. Vite inlines that file whole into the public browser bundle, so
// anything written inside it is shipped to every visitor. The reasoning lives
// here and in the two READMEs instead. Keep it that way.

import productFacts from "../product.json" with { type: "json" };

/** The Growth Report controlled-pilot price, e.g. "R6,500".
 *
 *  Formatted for reading, not for arithmetic. Nothing computes with it, nothing
 *  charges it, and no payment path exists anywhere in this service. */
export const GROWTH_REPORT_PILOT_PRICE: string = productFacts.growthReportPilotPrice;
