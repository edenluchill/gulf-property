/**
 * Area units — single source of truth (backend mirror of frontend/src/lib/units.ts).
 *
 * Dubai speaks two units and the source decides which one you get:
 *   • developer data (project_unit_types.area, brochures, floorplans) → sqft
 *   • DLD official data (procedure_area, meter_sale_price, area metrics) → m²
 *
 * Anything we hand to a human OR to an LLM speaks sqft. Converting at that edge
 * is what keeps Luna from saying "from 750 sqft" and "16,084 per sqm" in the
 * same breath.
 */

/** 1 m² = 10.7639 sqft (exact: 1 ft = 0.3048 m). */
export const SQFT_PER_SQM = 10.7639

export const sqmToSqft = (sqm: number): number => sqm * SQFT_PER_SQM
export const sqftToSqm = (sqft: number): number => sqft / SQFT_PER_SQM

/** Per-area prices convert INVERSELY: AED/m² ÷ 10.7639 = AED/sqft. */
export const pricePerSqmToPerSqft = (perSqm: number): number => perSqm / SQFT_PER_SQM
export const pricePerSqftToPerSqm = (perSqft: number): number => perSqft * SQFT_PER_SQM
