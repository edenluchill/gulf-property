/**
 * Generic sync orchestrator. Drives ANY DatasetConfig:
 *   fetch pages -> transform -> upsert -> track cursor -> audit.
 * Knows nothing about specific datasets (that's config/datasets.ts).
 */
import * as fs from 'fs'
import * as path from 'path'
import { DatasetConfig, SyncOptions, SyncResult, QueryParams } from './types'
import { iteratePages } from '../client/dataApi'
import { applyFieldMap } from './transform'
import { upsertBatch } from '../sinks/postgresSink'
import { archivePage } from '../sinks/r2Archive'
import { getCursor, setCursor } from './cursor'
import { startRun, finishRun, logRunError } from '../observability/runLog'
import { makeLogger } from '../observability/log'

export async function runSync(cfg: DatasetConfig, opts: SyncOptions): Promise<SyncResult> {
  const log = makeLogger(`sync:${cfg.key}`)
  const columns = Object.keys(cfg.fieldMap)
  const incCol = cfg.incremental?.column

  const cursorBefore = opts.mode === 'incremental' && incCol ? await getCursor(cfg.key) : null
  const modeLabel = opts.dryRun ? `${opts.mode}+dry` : opts.mode
  const runId = await startRun(cfg.key, modeLabel, cursorBefore)
  log.info(`run ${runId} mode=${opts.mode}${opts.dryRun ? ' (dry-run)' : ''} cursorBefore=${cursorBefore ?? '-'}`)

  const base: QueryParams = { pageSize: opts.pageSize ?? 1000 }
  if (incCol) {
    base.order_by = incCol
    base.order_dir = 'asc'
    if (opts.mode === 'incremental' && cursorBefore) {
      // PROD requires the value single-quoted: `col>'value'` (confirmed via probe
      // 2026-06-18 — unquoted `col>value` returns 400 InvalidFilter).
      base.filter = `${incCol}>'${cursorBefore}'`
    }
  }

  let pages = 0
  let rowsRead = 0
  let rowsUpserted = 0
  let errorCount = 0
  let maxCursor: string | null = cursorBefore

  try {
    for await (const { page, results } of iteratePages(cfg.entity, cfg.dataset, base, { maxRows: opts.limit })) {
      pages++
      rowsRead += results.length
      // Lossless raw archive to R2 (best-effort, never aborts the sync).
      try { await archivePage(cfg.key, runId, page, results) }
      catch (e: any) { log.warn(`R2 archive failed (page ${page}): ${e?.message ?? e}`) }
      if (opts.dump) dumpPage(runId, page, results)

      const mapped = results.map((r) => applyFieldMap(r, cfg.fieldMap))

      if (incCol) {
        for (const m of mapped) {
          const v = m[incCol]
          if (v != null && (!maxCursor || String(v) > maxCursor)) maxCursor = String(v)
        }
      }

      if (opts.dryRun) {
        if (page === 1) log.info('dry-run sample (mapped):', JSON.stringify(mapped[0], null, 2))
      } else {
        rowsUpserted += await upsertBatch(cfg.targetTable, columns, cfg.primaryKey, mapped)
      }
      log.info(`page ${page}: ${results.length} rows (read=${rowsRead}, upserted=${rowsUpserted})`)
    }

    if (!opts.dryRun && incCol && maxCursor && maxCursor !== cursorBefore) {
      await setCursor(cfg.key, maxCursor, runId)
    }
    await finishRun(runId, {
      status: 'success', pagesFetched: pages, rowsRead, rowsUpserted, errorCount, cursorAfter: maxCursor,
    })
    log.info(`✅ done: read=${rowsRead} upserted=${rowsUpserted} cursorAfter=${maxCursor ?? '-'}`)
    return {
      runId, datasetKey: cfg.key, mode: opts.mode, status: 'success',
      pagesFetched: pages, rowsRead, rowsUpserted, errorCount, cursorBefore, cursorAfter: maxCursor,
    }
  } catch (e: any) {
    errorCount++
    await logRunError(runId, pages + 1, e?.status ?? null, e?.message ?? String(e))
    await finishRun(runId, {
      status: 'failed', pagesFetched: pages, rowsRead, rowsUpserted, errorCount,
      cursorAfter: maxCursor, notes: (e?.message ?? String(e)).slice(0, 500),
    })
    log.error('run failed:', e?.message ?? e)
    throw e
  }
}

function dumpPage(runId: string, page: number, results: any[]): void {
  const dir = path.join(process.cwd(), 'uploads', 'dubai-sync', runId)
  fs.mkdirSync(dir, { recursive: true })
  fs.writeFileSync(path.join(dir, `page-${page}.json`), JSON.stringify(results, null, 2))
}
