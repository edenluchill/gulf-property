/**
 * Import official Dubai Municipality community boundary polygons (downloaded from
 * the DM ArcGIS FeatureServer) into dm_communities. Authoritative geometry +
 * COMM_NUM + names — used to give DLD areas real polygons and to auto-create the
 * areas missing from the hand-drawn map (no human assignment).
 *   cd backend && npx ts-node scripts/import-dm-communities.ts
 */
import dotenv from 'dotenv'
dotenv.config()
import pool from '../src/db/pool'
import * as fs from 'fs'
import * as path from 'path'

async function main() {
  const gj = JSON.parse(fs.readFileSync(path.resolve(__dirname, '../data/dm-communities.geojson'), 'utf8'))
  const feats = gj.features as any[]
  console.log(`features: ${feats.length}`)

  await pool.query(`
    CREATE TABLE IF NOT EXISTS dm_communities (
      comm_num   INTEGER PRIMARY KEY,
      name_en    TEXT,
      name_ar    TEXT,
      boundary   geometry(MultiPolygon, 4326),
      created_at TIMESTAMPTZ DEFAULT now()
    );
    TRUNCATE dm_communities;
    CREATE INDEX IF NOT EXISTS idx_dm_comm_boundary ON dm_communities USING gist (boundary);
  `)

  let ok = 0
  for (const f of feats) {
    const p = f.properties || {}
    if (p.COMM_NUM == null || !f.geometry) continue
    try {
      await pool.query(
        `INSERT INTO dm_communities (comm_num, name_en, name_ar, boundary)
         VALUES ($1,$2,$3, ST_Multi(ST_SetSRID(ST_GeomFromGeoJSON($4),4326)))
         ON CONFLICT (comm_num) DO UPDATE SET name_en=EXCLUDED.name_en, name_ar=EXCLUDED.name_ar, boundary=EXCLUDED.boundary`,
        [p.COMM_NUM, p.CNAME_E ?? null, p.CNAME_A ?? null, JSON.stringify(f.geometry)]
      )
      ok++
    } catch (e: any) {
      console.warn(`comm ${p.COMM_NUM} (${p.CNAME_E}) failed: ${e.message}`)
    }
  }
  console.log(`imported: ${ok}/${feats.length}`)
  await pool.end()
}
main().catch((e) => { console.error(e); process.exit(1) })
