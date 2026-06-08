/**
 * Dubai sync CLI.
 *
 *   npx ts-node src/sync/dubai/cli.ts discover
 *   npx ts-node src/sync/dubai/cli.ts discover dld dld_transactions-open-api
 *   npx ts-node src/sync/dubai/cli.ts sync dld_transactions --incremental
 *   npx ts-node src/sync/dubai/cli.ts sync dld_transactions --full --dry-run --limit=50
 *   npx ts-node src/sync/dubai/cli.ts sync-all --incremental
 *
 * Flags: --full | --incremental, --dry-run, --limit=N, --pageSize=N, --dump
 */
import pool from '../../db/pool'
import { discover } from './probe/discover'
import { runSync } from './core/syncEngine'
import { DATASETS } from './config/datasets'
import { SyncOptions } from './core/types'

function parseFlags(args: string[]): Record<string, string | boolean> {
  const f: Record<string, string | boolean> = {}
  for (const a of args) {
    if (a.startsWith('--')) {
      const [k, v] = a.slice(2).split('=')
      f[k] = v ?? true
    }
  }
  return f
}

function optsFromFlags(f: Record<string, string | boolean>): SyncOptions {
  return {
    mode: f.full ? 'full' : 'incremental',
    dryRun: !!f['dry-run'],
    limit: f.limit ? Number(f.limit) : undefined,
    pageSize: f.pageSize ? Number(f.pageSize) : undefined,
    dump: !!f.dump,
  }
}

async function main(): Promise<void> {
  const argv = process.argv.slice(2)
  const cmd = argv[0]
  const positional = argv.slice(1).filter((a) => !a.startsWith('-'))
  const flags = parseFlags(argv.slice(1))

  if (cmd === 'discover') {
    await discover(positional[0], positional[1])
  } else if (cmd === 'sync') {
    const key = positional[0]
    const cfg = DATASETS.find((d) => d.key === key)
    if (!cfg) throw new Error(`unknown dataset '${key}'. Known: ${DATASETS.map((d) => d.key).join(', ')}`)
    await runSync(cfg, optsFromFlags(flags))
  } else if (cmd === 'sync-all') {
    const opts = optsFromFlags(flags)
    for (const cfg of DATASETS.filter((d) => d.enabled !== false)) {
      await runSync(cfg, opts)
    }
  } else {
    console.log(
      `Usage:
  discover [entity dataset]                     validate auth+health; inspect a dataset's columns & filter syntax
  sync <key> [--full|--incremental] [--dry-run] [--limit=N] [--pageSize=N] [--dump]
  sync-all [--incremental] [...]

Known datasets: ${DATASETS.map((d) => `${d.key}${d.enabled === false ? '(disabled)' : ''}`).join(', ') || '(none)'}`
    )
  }
}

main()
  .catch((e) => {
    console.error('FATAL:', e?.message ?? e)
    process.exitCode = 1
  })
  .finally(() => pool.end())
