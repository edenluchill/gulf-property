/**
 * Pure value coercion + field mapping. No I/O.
 * Defensive against the messy/synthetic values STG returns
 * (e.g. invalid dates like "1992-13-40" -> null).
 */
import { FieldMap } from './types'

export function coerceText(v: any): string | null {
  if (v === null || v === undefined) return null
  const s = String(v).trim()
  return s === '' ? null : s
}

export function coerceNumber(v: any): number | null {
  if (v === null || v === undefined || v === '') return null
  const n = typeof v === 'number' ? v : parseFloat(String(v).replace(/,/g, ''))
  return Number.isFinite(n) ? n : null
}

export function coerceBool(v: any): boolean | null {
  if (v === null || v === undefined || v === '') return null
  if (typeof v === 'boolean') return v
  const s = String(v).trim().toLowerCase()
  if (['true', '1', 'yes', 'y'].includes(s)) return true
  if (['false', '0', 'no', 'n'].includes(s)) return false
  return null
}

function validYmd(y: number, mo: number, da: number): string | null {
  if (mo < 1 || mo > 12 || da < 1 || da > 31) return null
  return `${y}-${String(mo).padStart(2, '0')}-${String(da).padStart(2, '0')}`
}

/** Returns YYYY-MM-DD or null. Accepts ISO (YYYY-MM-DD…) and DD-MM-YYYY / DD/MM/YYYY. */
export function coerceDate(v: any): string | null {
  const s = coerceText(v)
  if (!s) return null
  let m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/)
  if (m) return validYmd(+m[1], +m[2], +m[3])
  m = s.match(/^(\d{1,2})[-/](\d{1,2})[-/](\d{4})/)
  if (m) return validYmd(+m[3], +m[2], +m[1])
  return null
}

/** Returns 'YYYY-MM-DD HH:MM:SS' (or date-only) or null. */
export function coerceDateTime(v: any): string | null {
  const s = coerceText(v)
  if (!s) return null
  const d = coerceDate(s)
  if (!d) return null
  const t = s.match(/(\d{2}):(\d{2}):(\d{2})/)
  return t ? `${d} ${t[0]}` : d
}

export function applyFieldMap(row: any, fieldMap: FieldMap): Record<string, any> {
  const out: Record<string, any> = {}
  for (const [target, spec] of Object.entries(fieldMap)) {
    const raw = row[spec.from]
    switch (spec.coerce) {
      case 'number': out[target] = coerceNumber(raw); break
      case 'bool': out[target] = coerceBool(raw); break
      case 'date': out[target] = coerceDate(raw); break
      case 'datetime': out[target] = coerceDateTime(raw); break
      case 'offplan': { const s = coerceText(raw); out[target] = s == null ? null : /off/i.test(s); break }
      default: out[target] = coerceText(raw)
    }
  }
  return out
}
