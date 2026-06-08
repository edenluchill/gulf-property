/**
 * Postgres sink. Knows the DB only — no API/dataset knowledge.
 * Idempotent multi-row upsert via INSERT ... ON CONFLICT DO UPDATE.
 * Re-runs and overlapping incremental windows are safe.
 */
import pool from '../../../db/pool'

const MAX_PARAMS = 60000 // stay under Postgres' 65535 bind-param limit

function q(id: string): string {
  return '"' + id.replace(/"/g, '""') + '"'
}
function qTable(t: string): string {
  return t.split('.').map(q).join('.')
}

export async function upsertBatch(
  table: string,
  columns: string[],
  primaryKey: string[],
  rows: Record<string, any>[]
): Promise<number> {
  if (rows.length === 0) return 0

  const perRow = columns.length
  const chunkSize = Math.max(1, Math.floor(MAX_PARAMS / perRow))
  const updateCols = columns.filter((c) => !primaryKey.includes(c))
  let affected = 0

  for (let i = 0; i < rows.length; i += chunkSize) {
    const chunk = rows.slice(i, i + chunkSize)
    const values: any[] = []
    const tuples = chunk.map((row, ri) => {
      const placeholders = columns.map((_, ci) => `$${ri * perRow + ci + 1}`)
      for (const c of columns) values.push(row[c] ?? null)
      return `(${placeholders.join(',')})`
    })

    const conflict =
      primaryKey.length && updateCols.length
        ? `ON CONFLICT (${primaryKey.map(q).join(',')}) DO UPDATE SET ${updateCols
            .map((c) => `${q(c)}=EXCLUDED.${q(c)}`)
            .join(',')}`
        : primaryKey.length
        ? `ON CONFLICT (${primaryKey.map(q).join(',')}) DO NOTHING`
        : 'ON CONFLICT DO NOTHING'

    const sql = `INSERT INTO ${qTable(table)} (${columns.map(q).join(',')}) VALUES ${tuples.join(',')} ${conflict}`
    const r = await pool.query(sql, values)
    affected += r.rowCount ?? 0
  }

  return affected
}
