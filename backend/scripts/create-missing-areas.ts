/**
 * Auto-create the display areas missing from the hand-drawn map, using official
 * DM community polygons. For each orphan DLD area that name-exact-matches an
 * official community, create a dubai_area from that community's authoritative
 * polygon + name, and bridge the DLD area(s) to it. Zero manual assignment.
 *   cd backend && npx ts-node scripts/create-missing-areas.ts
 */
import dotenv from 'dotenv'
dotenv.config()
import pool from '../src/db/pool'

async function main() {
  const matches = (await pool.query(`
    SELECT dla.area_id AS dld_area_id, dm.comm_num, dm.name_en, dm.name_ar
      FROM dld_areas dla
      JOIN dm_communities dm ON norm_area_name(dm.name_en) = norm_area_name(dla.area_name)
     WHERE dla.dubai_area_id IS NULL AND COALESCE(dla.transaction_count,0) > 0
  `)).rows

  const byComm = new Map<number, { name_en: string; name_ar: string; ids: number[] }>()
  for (const m of matches) {
    if (!byComm.has(m.comm_num)) byComm.set(m.comm_num, { name_en: m.name_en, name_ar: m.name_ar, ids: [] })
    byComm.get(m.comm_num)!.ids.push(m.dld_area_id)
  }
  console.log(`communities to create: ${byComm.size} (covering ${matches.length} DLD areas)`)

  const client = await pool.connect()
  let created = 0
  try {
    await client.query('BEGIN')
    for (const [comm_num, c] of byComm) {
      const ins = await client.query(
        `INSERT INTO dubai_areas (name, name_ar, boundary, description, color)
         SELECT initcap(dm.name_en), dm.name_ar,
                -- dubai_areas.boundary is Polygon; DM is MultiPolygon → take the
                -- largest part (data links by area_id, so geometry is display-only).
                (SELECT ST_SetSRID(d.geom, 4326)::geometry(Polygon,4326)
                   FROM ST_Dump(dm.boundary) d ORDER BY ST_Area(d.geom) DESC LIMIT 1),
                'Auto-added from official Dubai Municipality community boundary (' || dm.comm_num || ')',
                '#8b5cf6'
           FROM dm_communities dm WHERE dm.comm_num = $1
         RETURNING id`,
        [comm_num]
      )
      const areaId = ins.rows[0].id
      await client.query(
        `UPDATE dld_areas SET dubai_area_id = $1, dubai_area_name = initcap($2) WHERE area_id = ANY($3::int[])`,
        [areaId, c.name_en, c.ids]
      )
      created++
    }
    await client.query('COMMIT')
  } catch (e) {
    await client.query('ROLLBACK')
    throw e
  } finally {
    client.release()
  }

  const rent = await pool.query(
    `UPDATE dld_rent_contracts rc SET dubai_area_id = dla.dubai_area_id
       FROM dld_areas dla
      WHERE dla.area_id = rc.area_id AND rc.dubai_area_id IS NULL AND dla.dubai_area_id IS NOT NULL`
  )
  console.log(`created areas: ${created}, rent rows linked: ${rent.rowCount}`)
  await pool.end()
}
main().catch((e) => { console.error(e); process.exit(1) })
