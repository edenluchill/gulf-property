/**
 * Lead capture + scoring.
 *
 * Mounted at /api/leads.
 *   POST /contact  — capture a contact (from Luna's capture_contact tool or a
 *                    CTA form). Upserts by visitor_id, ties prior app_events to
 *                    the lead, computes intent + lead_score. PUBLIC (optionalAuth).
 *
 * Owner-only lead listing lives in routes/admin-analytics.ts (the dashboard).
 * No email alerts (decision 2026-06-17) — hot leads surface in the dashboard.
 */
import { Router, Request, Response } from 'express'
import pool from '../db/pool'
import { optionalAuth } from '../middleware/auth'
import { computeLeadProfile } from '../services/leadScoring'

const router = Router()

function clean(v: unknown, max = 200): string | null {
  if (typeof v !== 'string') return null
  const s = v.trim()
  return s ? s.slice(0, max) : null
}

router.post('/contact', optionalAuth, async (req: Request, res: Response) => {
  try {
    const b = (req.body || {}) as Record<string, unknown>
    const visitorId = clean(b.visitor_id, 128)
    const name = clean(b.name)
    const email = clean(b.email)
    const phone = clean(b.phone, 40)
    const whatsapp = clean(b.whatsapp, 40)
    const source = clean(b.source, 40) || 'manual'

    // Need a visitor to attribute behaviour, and at least one way to contact.
    if (!visitorId) return res.status(400).json({ success: false, error: 'visitor_id required' })
    if (!email && !phone && !whatsapp) {
      return res.status(400).json({ success: false, error: 'at least one contact method required' })
    }

    const { intent, score } = await computeLeadProfile(visitorId, true)

    const { rows } = await pool.query(
      `INSERT INTO leads (visitor_id, name, email, phone, whatsapp, source, intent, lead_score, last_seen_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7::jsonb,$8, now())
       ON CONFLICT (visitor_id) DO UPDATE SET
         name        = COALESCE(EXCLUDED.name, leads.name),
         email       = COALESCE(EXCLUDED.email, leads.email),
         phone       = COALESCE(EXCLUDED.phone, leads.phone),
         whatsapp    = COALESCE(EXCLUDED.whatsapp, leads.whatsapp),
         source      = COALESCE(leads.source, EXCLUDED.source),
         intent      = EXCLUDED.intent,
         lead_score  = EXCLUDED.lead_score,
         updated_at  = now(),
         last_seen_at = now()
       RETURNING id, visitor_id, name, email, phone, whatsapp, source, lead_score, status, created_at`,
      [visitorId, name, email, phone, whatsapp, source, JSON.stringify(intent), score]
    )

    res.json({ success: true, lead: rows[0] })
  } catch (err) {
    console.error('[leads] contact capture failed:', err)
    res.status(500).json({ success: false, error: 'failed to capture contact' })
  }
})

export default router
