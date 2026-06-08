/** Append-only audit of every sync run (sync_runs / sync_run_errors). */
import pool from '../../../db/pool'

export async function startRun(datasetKey: string, mode: string, cursorBefore: string | null): Promise<string> {
  const r = await pool.query(
    `INSERT INTO sync_runs (dataset_key, mode, status, cursor_before)
     VALUES ($1, $2, 'running', $3) RETURNING id`,
    [datasetKey, mode, cursorBefore]
  )
  return r.rows[0].id
}

export async function finishRun(
  runId: string,
  f: {
    status: string
    pagesFetched: number
    rowsRead: number
    rowsUpserted: number
    errorCount: number
    cursorAfter: string | null
    notes?: string
  }
): Promise<void> {
  await pool.query(
    `UPDATE sync_runs
     SET status = $2, finished_at = NOW(), pages_fetched = $3, rows_read = $4,
         rows_upserted = $5, error_count = $6, cursor_after = $7, notes = $8
     WHERE id = $1`,
    [runId, f.status, f.pagesFetched, f.rowsRead, f.rowsUpserted, f.errorCount, f.cursorAfter, f.notes ?? null]
  )
}

export async function logRunError(
  runId: string,
  page: number | null,
  httpStatus: number | null,
  message: string,
  sample?: string
): Promise<void> {
  await pool.query(
    `INSERT INTO sync_run_errors (run_id, page, http_status, message, payload_sample)
     VALUES ($1, $2, $3, $4, $5)`,
    [runId, page, httpStatus, message.slice(0, 2000), sample?.slice(0, 2000) ?? null]
  )
}
