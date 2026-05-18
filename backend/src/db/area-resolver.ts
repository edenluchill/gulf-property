/**
 * 共享区域解析：dubailand 的 AREA_EN → dld_transactions.area_id
 * （桥接 dld_areas，使既有指标 join 不变）。
 * 级联：精确 → 归一精确 → 归一双向包含(dubai_areas) → 人工别名 → area-matcher 模糊。
 * 导入器与回填脚本共用，保证口径一致 + 防复发。
 */
import { Pool } from 'pg'
import { findAreaByName } from '../services/area-matcher'

// dubailand 名 → dubai_areas.name 的人工别名（仅放归一/模糊都救不回的：拼写差异/缩写/分期）
export const AREA_ALIASES: Record<string, string> = {
  'JUMEIRAH VILLAGE TRIANGLE': 'JVT Jumeirah villiage triangle',
  'JUMEIRAH LAKES TOWERS': 'JLT Jumeirah Lake tower',
  'JUMEIRAH ISLANDS': 'Jumeriah island',
  'INTERNATIONAL CITY PH 1': 'International City',
  'INTERNATIONAL CITY PH 2 & 3': 'International City',
  'DUBAI LAND RESIDENCE COMPLEX': 'Dubai Rensidence complex',
  'EMIRATE LIVING': 'Emirates Hills',
  'THE LAKES': 'The Lake',
  'LA MER': 'Port De La Mer',
  'BLUEWATERS': 'Blue water',
  'MEYDAN ONE': 'Azizi Rivera at Maydan One',
  'MEYDAN AVENUE': 'Azizi Rivera at Maydan One',
  'MBR DISTRICT 1': 'MBR City District 1',
  'MBR DISTRICT 7': 'MBR City District 7',
  'DUBAI INDUSTRIAL CITY': 'Dubai industrial City',
  'DUBAI WATER FRONT': 'Dubai Harbour',
  'DUBAI WATER CANAL': 'Business Bay',
  'JADDAF WATERFRONT': 'Al Jadaf Waterfront',
  'PEARL JUMEIRA': 'Pearl Jumeirah',
  'MINA RASHID': 'Mina Rashid',
  'DUBAI LIFESTYLE CITY': 'Dubai Life style city',
  'DUBAI DESIGN DISTRICT': 'D3 Dubai Dsign District 3',
}

export function buildAreaResolver(pool: Pool) {
  const cache = new Map<string, number | null>()

  // 取该 dubai_area 的 dld_areas.area_id；没有桥接则幂等创建一个合成行
  // （900000+ 段，永不与真实 DLD id(<1000) 冲突；按 dubai_area 复用，可逆）
  async function dldAreaIdForDubaiArea(dubaiAreaId: string): Promise<number | null> {
    const b = await pool.query(
      `SELECT area_id FROM dld_areas WHERE dubai_area_id = $1 AND area_id IS NOT NULL
        ORDER BY area_id LIMIT 1`, [dubaiAreaId])
    if (b.rowCount) return b.rows[0].area_id

    // 无桥接 → 合成。取该区名 + 下一个空闲合成 id
    const nameRes = await pool.query(
      `SELECT name FROM dubai_areas WHERE id = $1`, [dubaiAreaId])
    if (!nameRes.rowCount) return null
    const ins = await pool.query(
      `INSERT INTO dld_areas (area_id, area_name, dubai_area_id)
       SELECT COALESCE((SELECT MAX(area_id) FROM dld_areas WHERE area_id >= 900000), 899999) + 1,
              $2, $1
       WHERE NOT EXISTS (SELECT 1 FROM dld_areas WHERE dubai_area_id = $1 AND area_id >= 900000)
       RETURNING area_id`, [dubaiAreaId, nameRes.rows[0].name])
    if (ins.rowCount) return ins.rows[0].area_id
    // 并发/已存在 → 再读
    const re = await pool.query(
      `SELECT area_id FROM dld_areas WHERE dubai_area_id = $1 AND area_id >= 900000 LIMIT 1`,
      [dubaiAreaId])
    return re.rowCount ? re.rows[0].area_id : null
  }

  return async function resolveAreaId(areaEn: string): Promise<number | null> {
    const key = (areaEn || '').trim().toUpperCase()
    if (!key) return null
    if (cache.has(key)) return cache.get(key)!
    const set = (v: number | null) => { cache.set(key, v); return v }

    // 1) dld_areas 精确
    let r = await pool.query(
      `SELECT area_id FROM dld_areas WHERE UPPER(TRIM(area_name)) = $1 LIMIT 1`, [key])
    if (r.rowCount) return set(r.rows[0].area_id)

    // 2) dld_areas 归一精确
    r = await pool.query(
      `SELECT area_id FROM dld_areas
        WHERE regexp_replace(UPPER(area_name),'[^A-Z0-9]','','g') = regexp_replace($1,'[^A-Z0-9]','','g')
        LIMIT 1`, [key])
    if (r.rowCount) return set(r.rows[0].area_id)

    // 3) 人工别名 → dubai_areas → 桥接 area_id
    const alias = AREA_ALIASES[key]
    if (alias) {
      const da = await pool.query(
        `SELECT id FROM dubai_areas WHERE UPPER(TRIM(name)) = UPPER(TRIM($1)) AND visible LIMIT 1`, [alias])
      if (da.rowCount) {
        const id = await dldAreaIdForDubaiArea(da.rows[0].id)
        if (id != null) return set(id)
      }
    }

    // 4) dubai_areas 归一双向包含 → 桥接 area_id
    const da2 = await pool.query(
      `SELECT id FROM dubai_areas
        WHERE visible AND (
          regexp_replace(UPPER(name),'[^A-Z0-9]','','g') LIKE '%'||regexp_replace($1,'[^A-Z0-9]','','g')||'%'
          OR regexp_replace($1,'[^A-Z0-9]','','g') LIKE '%'||regexp_replace(UPPER(name),'[^A-Z0-9]','','g')||'%')
        ORDER BY length(name) LIMIT 1`, [key])
    if (da2.rowCount) {
      const id = await dldAreaIdForDubaiArea(da2.rows[0].id)
      if (id != null) return set(id)
    }

    // 5) area-matcher 级联模糊 → 桥接 area_id
    try {
      const da = await findAreaByName(pool, areaEn)
      if (da && da.id) {
        const id = await dldAreaIdForDubaiArea(da.id)
        if (id != null) return set(id)
      }
    } catch { /* ignore */ }

    return set(null)
  }
}
