import { Pool } from 'pg'
import dotenv from 'dotenv'

dotenv.config()

const pool = new Pool({
  host: process.env.DB_HOST || 'localhost',
  port: parseInt(process.env.DB_PORT || '5432'),
  database: process.env.DB_NAME || 'pinzos',
  user: process.env.DB_USER || 'postgres',
  password: process.env.DB_PASSWORD,
  max: 50,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 2000,
})

// pool.on('connect', () => {
//   console.log('✅ Connected to PostgreSQL database')
// })

pool.on('error', (err) => {
  console.error('❌ Unexpected error on idle client', err)
  // Graceful: log but don't crash — pool will reconnect automatically
})

// ── Query timing for the perf monitor ───────────────────────────────────────
// Wrap pool.query so every query reports its duration to the in-memory sink
// (slow-query detection). Only the promise form is timed; the callback form
// (rarely used) passes straight through. Timing failures are swallowed so DB
// access is never affected. perfSink has no imports → no circular dependency.
import { recordQuery } from '../services/perfSink'

const origQuery = pool.query.bind(pool)
// eslint-disable-next-line @typescript-eslint/no-explicit-any
;(pool as any).query = function (...args: any[]) {
  const last = args[args.length - 1]
  // Callback form (last arg is a function): don't wrap, just pass through.
  if (typeof last === 'function') {
    return origQuery(...(args as Parameters<typeof origQuery>))
  }
  const start = process.hrtime.bigint()
  const report = () => {
    try {
      recordQuery(Number(process.hrtime.bigint() - start) / 1e6)
    } catch {
      /* never let timing break a query */
    }
  }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const result: any = origQuery(...(args as Parameters<typeof origQuery>))
  if (result && typeof result.then === 'function') {
    result.then(report, report)
  }
  return result
}

export default pool
