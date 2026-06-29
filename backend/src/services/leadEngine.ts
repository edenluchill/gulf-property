/**
 * Lead engine — turns behaviour into leads automatically (strategy C5).
 *
 * Until now a lead was only ever born when a visitor *told* us who they are
 * (Luna's capture_contact tool, or a CTA form → POST /api/leads/contact). That
 * left `leads` permanently at 0 while plenty of anonymous visitors researched
 * deeply and quietly left (the "no_contact" churn reason in getLostCustomers).
 *
 * This engine watches the freshly-ingested event stream and, when a visitor
 * either performs a high-intent action (tried to contact, favourited) or crosses
 * an intent score threshold (deep research), upserts a lead row — even with no
 * contact details yet. The owner gets a worklist of people worth chasing; if the
 * same visitor later leaves contact info, the existing row (keyed by visitor_id)
 * is enriched in place rather than duplicated.
 *
 * Fire-and-forget from the ingest path: it must NEVER block or throw into a
 * request (telemetry must not disrupt the app — analytics spec §5).
 */
import pool from './../db/pool'
import { computeIntent, scoreFromIntent } from './leadScoring'
import { internalVisitorIds } from './analyticsQueries'
import type { CleanEvent, IngestContext } from './eventIngest'

// Behaviour alone makes a lead once intent crosses this score. A visitor who
// views 5 properties already scores 30; tunable via env without a redeploy.
const AUTO_LEAD_THRESHOLD = Number(process.env.AUTO_LEAD_SCORE_THRESHOLD) || 30

// Events worth (re)evaluating a visitor's lead on. A bare page_view isn't — these
// signal genuine interest (research) or intent (reaching out / saving).
const SIGNAL_EVENTS = new Set([
  'contact_attempt',
  'favorite_toggle',
  'property_view',
  'luna_open',
  'resource_download',
  'report_action',
  'share_action',
])

/**
 * The strongest signals: doing any of these makes a lead regardless of score —
 * the visitor actively reached out or saved something. (favorite_toggle only
 * counts when it's an ADD, not an un-favourite — see isStrongSignal.)
 */
function isStrongSignal(e: CleanEvent): boolean {
  if (e.event_type === 'contact_attempt') return true
  if (e.event_type === 'favorite_toggle') {
    try {
      const a = String((JSON.parse(e.payload) as { action?: unknown }).action || '').toLowerCase()
      return a === 'add' || a === 'save' || a === 'saved' || a === 'favorite'
    } catch {
      return false
    }
  }
  return false
}

/**
 * Entry point — call fire-and-forget after ingestEvents() has written `clean`.
 * Groups the batch by visitor, drops internal/test traffic, and evaluates each
 * candidate. Swallows all errors (logs only); resolves void.
 */
export async function processEventsForLeads(events: CleanEvent[], ctx: IngestContext): Promise<void> {
  try {
    // Visitors that emitted a signal this batch, and whether it was a strong one.
    const candidates = new Map<string, boolean>()
    for (const e of events) {
      if (!SIGNAL_EVENTS.has(e.event_type)) continue
      candidates.set(e.visitor_id, (candidates.get(e.visitor_id) || false) || isStrongSignal(e))
    }
    if (candidates.size === 0) return

    const internal = new Set(await internalVisitorIds())

    for (const [visitorId, strong] of candidates) {
      if (internal.has(visitorId)) continue // never make leads out of our own testing
      await evaluateVisitor(visitorId, strong, ctx)
    }
  } catch (err) {
    console.error('[leadEngine] processEventsForLeads failed:', err)
  }
}

/** Most recent contact email we can attribute to this visitor (logged-in session). */
async function latestEmail(visitorId: string, ctxEmail: string | null): Promise<string | null> {
  if (ctxEmail) return ctxEmail
  const { rows } = await pool.query(
    `SELECT user_email FROM app_events
      WHERE visitor_id = $1 AND user_email IS NOT NULL
      ORDER BY created_at DESC LIMIT 1`,
    [visitorId]
  )
  return rows[0]?.user_email ?? null
}

/** Decide + upsert. Strong signal → always; otherwise only above the threshold. */
async function evaluateVisitor(visitorId: string, strong: boolean, ctx: IngestContext): Promise<void> {
  const email = await latestEmail(visitorId, ctx.userEmail ?? null)
  const intent = await computeIntent(visitorId)

  // Base score covers views/luna/searches. But a WhatsApp tap or a save is a far
  // stronger buying signal than a view — fold those in so a hot lead ranks above
  // a passive researcher (weights mirror analyticsQueries.quickScore for parity).
  const { rows: sig } = await pool.query(
    `SELECT
        COUNT(*) FILTER (WHERE event_type = 'contact_attempt')                              AS contacts,
        COUNT(*) FILTER (WHERE event_type = 'favorite_toggle' AND payload->>'action' = 'add') AS favorites
       FROM app_events WHERE visitor_id = $1`,
    [visitorId]
  )
  const contacts = Number(sig[0]?.contacts) || 0
  const favorites = Number(sig[0]?.favorites) || 0
  const score =
    scoreFromIntent(intent, !!email) + Math.min(contacts, 3) * 18 + Math.min(favorites, 5) * 8

  if (!strong && score < AUTO_LEAD_THRESHOLD) return

  // 'behavior_intent' = actively reached out/saved; 'behavior' = deep research.
  const source = strong ? 'behavior_intent' : 'behavior'

  // Upsert by visitor_id. We never downgrade a richer existing lead: keep its
  // source/email if already set, and only raise the score (a Luna lead carries
  // the +contact bonus a behavioural recompute wouldn't).
  await pool.query(
    `INSERT INTO leads (visitor_id, email, source, intent, lead_score, last_seen_at)
     VALUES ($1,$2,$3,$4::jsonb,$5, now())
     ON CONFLICT (visitor_id) DO UPDATE SET
       email        = COALESCE(leads.email, EXCLUDED.email),
       source       = COALESCE(leads.source, EXCLUDED.source),
       intent       = EXCLUDED.intent,
       lead_score   = GREATEST(leads.lead_score, EXCLUDED.lead_score),
       updated_at   = now(),
       last_seen_at = now()`,
    [visitorId, email, source, JSON.stringify(intent), score]
  )
}
