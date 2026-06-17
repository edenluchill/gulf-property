/**
 * Lead scoring — derives an intent profile + numeric score for a visitor from
 * their app_events history. Pure data logic (no req/res) so it's testable and
 * reusable. See docs/analytics-dashboard-spec.md §6.4.
 *
 * Scoring is intentionally simple and transparent; tune the weights freely.
 */
import pool from '../db/pool'

export interface LeadIntent {
  searches: number
  property_views: number
  opened_luna: boolean
  areas: string[]
  project_ids: string[]
  search_terms: string[]
}

export interface LeadProfile {
  intent: LeadIntent
  score: number
}

const WEIGHTS = {
  hasContact: 25, // applied by caller (we don't know contact here)
  perPropertyView: 6, // capped
  propertyViewCap: 5,
  openedLuna: 12,
  perSearch: 4, // capped
  searchCap: 5,
}

/** Build the intent profile for a visitor from app_events. */
export async function computeIntent(visitorId: string): Promise<LeadIntent> {
  const { rows } = await pool.query(
    `SELECT event_type, project_id, payload FROM app_events WHERE visitor_id = $1`,
    [visitorId]
  )

  let searches = 0
  let propertyViews = 0
  let openedLuna = false
  const areas = new Set<string>()
  const projectIds = new Set<string>()
  const searchTerms = new Set<string>()

  for (const r of rows) {
    switch (r.event_type) {
      case 'search': {
        searches++
        const q = r.payload?.query
        if (typeof q === 'string' && q.trim()) searchTerms.add(q.trim())
        if (r.payload?.kind === 'area' && typeof r.payload?.label === 'string') areas.add(r.payload.label)
        break
      }
      case 'property_view':
        propertyViews++
        if (r.project_id) projectIds.add(r.project_id)
        if (typeof r.payload?.area === 'string') areas.add(r.payload.area)
        break
      case 'luna_open':
        openedLuna = true
        break
    }
  }

  return {
    searches,
    property_views: propertyViews,
    opened_luna: openedLuna,
    areas: [...areas].slice(0, 20),
    project_ids: [...projectIds].slice(0, 50),
    search_terms: [...searchTerms].slice(0, 20),
  }
}

/** Score = intent signals + an optional contact bonus (caller knows contact). */
export function scoreFromIntent(intent: LeadIntent, hasContact: boolean): number {
  let score = 0
  if (hasContact) score += WEIGHTS.hasContact
  score += Math.min(intent.property_views, WEIGHTS.propertyViewCap) * WEIGHTS.perPropertyView
  if (intent.opened_luna) score += WEIGHTS.openedLuna
  score += Math.min(intent.searches, WEIGHTS.searchCap) * WEIGHTS.perSearch
  return score
}

export async function computeLeadProfile(visitorId: string, hasContact: boolean): Promise<LeadProfile> {
  const intent = await computeIntent(visitorId)
  return { intent, score: scoreFromIntent(intent, hasContact) }
}
