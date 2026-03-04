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

export default pool
