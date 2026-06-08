/** Shared types for the Dubai sync engine. */

export type SyncMode = 'full' | 'incremental'

export type Coerce = 'date' | 'datetime' | 'number' | 'bool' | 'text' | 'offplan'

export interface FieldSpec {
  /** Field name in the data.dubai API response row. */
  from: string
  /** How to coerce the raw value before writing to the DB. Defaults to 'text'. */
  coerce?: Coerce
}

/** Map of target DB column -> source API field. */
export interface FieldMap {
  [targetColumn: string]: FieldSpec
}

/**
 * One dataset = one declarative config object.
 * Adding a new dataset to sync means adding one of these to config/datasets.ts —
 * no new code.
 */
export interface DatasetConfig {
  /** Unique key inside this system (used in CLI + sync_runs + sync_cursors). */
  key: string
  /** data.dubai entity path segment, e.g. 'dld'. */
  entity: string
  /** data.dubai dataset path segment, e.g. 'dld_transactions-open-api'. */
  dataset: string
  /** Target Postgres table to upsert into. */
  targetTable: string
  /** Primary key column(s) for ON CONFLICT. */
  primaryKey: string[]
  /** Target column -> source field map. Keys are the columns written. */
  fieldMap: FieldMap
  /** If set, enables incremental sync keyed on this (target) column. Must be a key in fieldMap. */
  incremental?: { column: string }
  /** Set false to skip in sync-all. */
  enabled?: boolean
}

export interface QueryParams {
  page?: number
  pageSize?: number
  limit?: number
  filter?: string
  column?: string
  order_by?: string
  order_dir?: 'asc' | 'desc'
  offset?: number
}

export interface SyncOptions {
  mode: SyncMode
  dryRun?: boolean
  /** Stop after this many rows (sampling/testing). */
  limit?: number
  pageSize?: number
  /** Write each raw page to uploads/dubai-sync/<runId>/page-N.json for debugging. */
  dump?: boolean
}

export interface SyncResult {
  runId: string
  datasetKey: string
  mode: string
  status: 'success' | 'failed' | 'partial'
  pagesFetched: number
  rowsRead: number
  rowsUpserted: number
  errorCount: number
  cursorBefore: string | null
  cursorAfter: string | null
}
