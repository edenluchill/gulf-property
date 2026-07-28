import { config } from 'dotenv'
import { resolve } from 'path'
config({ path: resolve(__dirname, '../.env') })
import pool from '../src/db/pool'
;(async () => {
  const { rows } = await pool.query(
    `SELECT COALESCE(a.email,'(未登录建房)') 经纪, count(*) 房间, count(*) FILTER (WHERE r.peak_participants>=2) 有客户进
       FROM collab_rooms r LEFT JOIN lt_agents a ON a.id=r.agent_id
      WHERE r.created_at > now() - interval '30 days'
      GROUP BY 1 ORDER BY 2 DESC`)
  console.table(rows)
  process.exit(0)
})()
