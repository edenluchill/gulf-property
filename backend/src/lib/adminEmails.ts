/**
 * Admin allow-list — the single source of truth for who has ADMIN access
 * (admin management pages + the data/analytics dashboard).
 *
 * Deliberately separate from OWNER_EMAILS (see middleware/requireOwner). "Owner"
 * carries billing/credit/agent-approval privileges (unlimited Luna, no billing,
 * auto-approved agent) and must stay narrow. "Admin" is purely an operational
 * gate — being an admin should NOT grant those owner perks. Restricted to a fixed
 * set of accounts; override with the ADMIN_EMAILS env (comma-separated).
 */
export const ADMIN_EMAILS = (
  process.env.ADMIN_EMAILS || 'lzp6529@gmail.com,shelldubai26@gmail.com'
)
  .split(',')
  .map((s) => s.trim().toLowerCase())
  .filter(Boolean)

export function isAdminEmail(email?: string | null): boolean {
  if (!email) return false
  return ADMIN_EMAILS.includes(email.toLowerCase())
}
