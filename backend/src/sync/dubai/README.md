# Dubai data.dubai Sync

Incremental sync of Dubai government open data (DLD sales/rent etc.) into our Postgres.
Full design: `docs/dubai-data-api-sync-spec.md`.

## Layers (decoupled — each knows nothing about the others)

```
cli.ts ──▶ core/syncEngine ──▶ client/*   (HTTP + OAuth, knows no DB)
                            ├─▶ config/datasets.ts  (declarative — add a dataset here, zero new code)
                            ├─▶ core/transform      (pure value coercion)
                            └─▶ sinks/postgresSink  (DB upsert, knows no API)
            observability/* (sync_runs / sync_run_errors / sync_cursors audit)
            probe/discover  (Phase-0: validate + inspect a dataset)
```

## ⚠️ Two hard constraints
- **UAE-only:** the API rejects non-UAE IPs. Run this from the UAE box (or via `DUBAI_API_PROXY_URL`).
- **Per-dataset access:** each dataset must be granted on the data.dubai portal before it returns data.

## Setup
1. Env in `backend/.env`: `DUBAI_API_BASE_URL`, `DUBAI_API_APP_ID`, `DUBAI_API_CLIENT_ID`, `DUBAI_API_CLIENT_SECRET`, (optional) `DUBAI_API_PROXY_URL`.
2. Create audit tables once:
   ```
   cd backend && npx ts-node scripts/db-runner.ts src/db/dubai-sync-schema.sql
   ```

## Usage
```bash
# validate auth + health (no dataset needed)
npx ts-node src/sync/dubai/cli.ts discover

# inspect a granted dataset: columns, sample row, filter syntax
npx ts-node src/sync/dubai/cli.ts discover dld <dataset-slug>

# sync one dataset (after filling its config in config/datasets.ts)
npx ts-node src/sync/dubai/cli.ts sync dld_transactions --full --dry-run --limit=50
npx ts-node src/sync/dubai/cli.ts sync dld_transactions --incremental

# all enabled datasets, incrementally
npx ts-node src/sync/dubai/cli.ts sync-all --incremental
```

Flags: `--full | --incremental`, `--dry-run`, `--limit=N`, `--pageSize=N`, `--dump` (raw pages → `uploads/dubai-sync/<runId>/`).

## Add a dataset
1. Request access on the portal → get the real `entity`/`dataset` slug.
2. `discover <entity> <dataset>` → read the real columns.
3. Add a `DatasetConfig` to `config/datasets.ts` (fill `fieldMap`, set `enabled: true`).
4. `sync <key> --full --dry-run` to sanity-check, then run for real.

## Debug
```sql
SELECT * FROM sync_runs ORDER BY started_at DESC LIMIT 20;
SELECT * FROM sync_run_errors ORDER BY created_at DESC LIMIT 20;
SELECT * FROM sync_cursors;
```
