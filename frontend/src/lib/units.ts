/**
 * Area units — single source of truth.
 *
 * Dubai speaks two units and the source decides which one you get:
 *   • developer data (brochures, floorplans, payment plans) → sqft
 *   • DLD official data (transactions, rent contracts, area metrics) → m²
 *
 * The UI speaks ONE: sqft. That is what agents quote and what buyers anchor on.
 * Anything arriving in m² gets converted here, at the display edge — never by
 * hardcoding 10.764 at the call site again.
 */

/** 1 m² = 10.7639 sqft (exact: 1 ft = 0.3048 m). */
export const SQFT_PER_SQM = 10.7639

export const sqmToSqft = (sqm: number): number => sqm * SQFT_PER_SQM
export const sqftToSqm = (sqft: number): number => sqft / SQFT_PER_SQM

/**
 * Per-area prices convert INVERSELY: AED/m² ÷ 10.7639 = AED/sqft.
 * Named explicitly because dividing when you meant to multiply is a 116x error
 * that still looks like a plausible price.
 */
export const pricePerSqmToPerSqft = (perSqm: number): number => perSqm / SQFT_PER_SQM
export const pricePerSqftToPerSqm = (perSqft: number): number => perSqft * SQFT_PER_SQM
