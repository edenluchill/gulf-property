/** Incremental cursor storage (one row per dataset in sync_cursors). */
import pool from '../../../db/pool'

export async function getCursor(datasetKey: string): Promise<string | null> {
  const r = await pool.query('SELECT last_value FROM sync_cursors WHERE dataset_key = $1', [datasetKey])
  return r.rows[0]?.last_value ?? null
}

export async function setCursor(datasetKey: string, value: string | null, runId: string): Promise<void> {
  if (value === null) return
  await pool.query(
    `INSERT INTO sync_cursors (dataset_key, last_value, last_run_id, updated_at)
     VALUES ($1, $2, $3, NOW())
     ON CONFLICT (dataset_key)
     DO UPDATE SET last_value = EXCLUDED.last_value,
                   last_run_id = EXCLUDED.last_run_id,
                   updated_at = NOW()`,
    [datasetKey, value, runId]
  )
}
