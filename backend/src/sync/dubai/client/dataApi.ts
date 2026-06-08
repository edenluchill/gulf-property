/**
 * High-level data.dubai Data API access: fetch a page, or iterate all pages.
 * Returns raw API rows — transformation/DB are someone else's job.
 */
import { apiGet } from './httpClient'
import { QueryParams } from '../core/types'

export interface PageResult {
  results: any[]
  raw: any
}

function dataPath(entity: string, dataset: string): string {
  // Alias form documented as /open/<entity>/<dataset> for open datasets.
  return `/open/${encodeURIComponent(entity)}/${encodeURIComponent(dataset)}`
}

export async function fetchPage(entity: string, dataset: string, params: QueryParams): Promise<PageResult> {
  const q: Record<string, any> = {}
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && v !== null && v !== '') q[k] = v
  }
  const data = await apiGet<any>(dataPath(entity, dataset), q)
  const results = Array.isArray(data?.results) ? data.results : []
  return { results, raw: data }
}

/**
 * Async generator over pages. Stops when a page is empty or shorter than pageSize,
 * or when maxRows is reached.
 */
export async function* iteratePages(
  entity: string,
  dataset: string,
  base: QueryParams,
  opts: { maxRows?: number } = {}
): AsyncGenerator<{ page: number; results: any[] }> {
  const pageSize = base.pageSize ?? 1000
  let page = base.page ?? 1
  let total = 0

  while (true) {
    const { results } = await fetchPage(entity, dataset, { ...base, page, pageSize })
    if (results.length === 0) break

    yield { page, results }

    total += results.length
    if (opts.maxRows && total >= opts.maxRows) break
    if (results.length < pageSize) break
    page++
  }
}
