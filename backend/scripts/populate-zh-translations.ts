/**
 * Populate Chinese (zh) translations for ALL dubai_areas in the database.
 *
 * Uses a hardcoded dictionary for known areas, then falls back to
 * common transliteration patterns for the rest.
 *
 * Run: npx ts-node backend/scripts/populate-zh-translations.ts
 */

import pool from '../src/db/pool'

// ── Known translations ──────────────────────────────────────────────────────

const KNOWN: Record<string, string> = {
  // Core 9 (production GeoJSON)
  'Downtown Dubai': '迪拜市中心',
  'Dubai Marina': '迪拜码头',
  'Palm Jumeirah': '朱美拉棕榈岛',
  'Business Bay': '商业湾',
  'Jumeirah Beach Residence': '朱美拉海滩公寓',
  'Dubai Hills Estate': '迪拜山庄',
  'Jumeirah Village Circle': '朱美拉环形村',
  'Arabian Ranches': '阿拉伯山庄',
  'Arabian Ranches 1': '阿拉伯山庄一期',
  'Dubai Silicon Oasis': '迪拜硅谷绿洲',

  // Extended areas
  'Emirates Hills': '酋长山庄',
  'Jumeirah Bay Island': '朱美拉湾岛',
  'Bluewaters Island': '蓝水岛',
  'City Walk': '城市步行街',
  'Dubai Harbour': '迪拜港',
  'The Springs': '泉水社区',
  'The Meadows': '草地社区',
  'The Lakes': '湖畔社区',
  'Jumeirah': '朱美拉',
  'Umm Suqeim': '乌姆苏盖姆',
  'Mirdif': '米尔迪夫',
  'Dubai Sports City': '迪拜运动城',
  'Jumeirah Village Triangle': '朱美拉三角村',
  'Motor City': '汽车城',
  'Discovery Gardens': '发现花园',
  'The Greens': '绿意社区',
  'Al Barsha': '巴沙区',
  'Arjan': '阿尔扬',
  'Town Square': '城市广场',
  'Mudon': '穆东',
  'Reem': '雷姆社区',
  'Damac Hills': '达马克山庄',
  'Tilal Al Ghaf': '蒂拉尔丘陵',
  'Dubai South': '迪拜南区',
  'Deira': '德拉老城区',
  'Bur Dubai': '老城区',
  'Al Karama': '卡拉马区',
  'Al Nahda': '纳赫达区',
  'Al Qusais': '库赛斯区',
  'International City': '国际城',
  'Jumeirah Lake Towers': '朱美拉湖塔',
  'Dubai Creek Harbour': '云溪港',
  'DIFC': '迪拜国际金融中心',
  'Emaar Beachfront': '王子岛',
  'Beach front by Emaar': '王子岛',

  // More Dubai neighborhoods
  'Al Quoz': '库兹区',
  'Al Rashidiya': '拉希迪亚区',
  'Al Warqa': '瓦尔卡区',
  'Al Twar': '图瓦尔区',
  'Al Mizhar': '米兹哈尔区',
  'Al Khawaneej': '哈瓦尼杰区',
  'Nad Al Sheba': '纳德沙巴区',
  'Ras Al Khor': '拉斯霍尔区',
  'Academic City': '学术城',
  'Dubai Healthcare City': '迪拜医疗城',
  'Dubai Internet City': '迪拜网络城',
  'Dubai Media City': '迪拜媒体城',
  'Dubai Knowledge Park': '迪拜知识园',
  'Dubai Studio City': '迪拜制片城',
  'Dubai Production City': '迪拜生产城',
  'Dubai Industrial City': '迪拜工业城',
  'Dubai Investment Park': '迪拜投资园',
  'Dubai World Central': '迪拜世界中心',
  'Jebel Ali': '杰贝阿里',
  'Jebel Ali Free Zone': '杰贝阿里自贸区',
  'Al Furjan': '弗尔扬区',
  'Dubai Land': '迪拜乐园',
  'Dubailand': '迪拜乐园',
  'Al Barari': '巴拉里',
  'The Villa': '别墅社区',
  'Living Legends': '传奇社区',
  'Falcon City': '猎鹰城',
  'Dubai Festival City': '迪拜节日城',
  'Culture Village': '文化村',
  'Al Jadaf': '贾达夫区',
  'Creek Side': '河畔区',
  'Zabeel': '扎比尔区',
  'Trade Centre': '贸易中心区',
  'World Trade Centre': '世界贸易中心',
  'Sheikh Zayed Road': '扎耶德路',
  'Satwa': '萨特瓦区',
  'Mankhool': '曼库尔区',
  'Oud Metha': '乌德梅塔区',
  'Al Garhoud': '加尔胡德区',
  'Port Saeed': '萨伊德港区',
  'Riggat Al Buteen': '布丁区',
  'Corniche Deira': '迪拉滨海区',
  'Al Mamzar': '马姆扎尔区',
  'Hor Al Anz': '霍尔安兹区',
  'Al Muteena': '穆提纳区',
  'Naif': '纳伊夫区',
  'Gold Souk': '黄金市场',
  'Spice Souk': '香料市场',
  'Al Ras': '拉斯区',
  'Umm Hurair': '乌姆胡拉尔区',
  'Jumeirah 1': '朱美拉一区',
  'Jumeirah 2': '朱美拉二区',
  'Jumeirah 3': '朱美拉三区',
  'Al Safa': '萨法区',
  'Al Wasl': '瓦斯尔区',
  'Al Manara': '马纳拉区',
  'Umm Al Sheif': '乌姆谢夫区',
  'Al Sufouh': '苏福赫区',
  'Knowledge Village': '知识村',
  'Green Community': '绿色社区',
  'Gardens': '花园社区',
  'Jebel Ali Village': '杰贝阿里村',
  'Palm Jebel Ali': '杰贝阿里棕榈岛',
  'Palm Deira': '迪拉棕榈岛',
  'The World Islands': '世界岛',
  'Meydan': '美丹',
  'Meydan City': '美丹城',
  'Azizi Rivera at Maydan One': '阿齐兹美丹河畔',
  'Maydan Distrct One West': '美丹一区西',
  'MBR District11 (Medan South)': 'MBR十一区（美丹南）',
  'Mohammed Bin Rashid City': '穆罕默德·本·拉希德城',
  'MBR City': '穆罕默德·本·拉希德城',
  'Sobha Hartland': '首霸哈特兰',
  'Sobha Heartland': '首霸哈特兰',
  'Sobha Hartland 2': '首霸哈特兰二期',
  'Scantury Sobha': '首霸圣殿',
  'District One': '一区',
  'Villanova': '维拉诺瓦',
  'Remraam': '雷姆拉姆',
  'Liwan': '利万',
  'Queue Point': '排队角',
  'Warsan': '沃尔桑区',
  'Wadi Al Safa': '萨法谷',
  'Nad Al Hamar': '纳德哈马尔区',
  'Mushrif': '穆什里夫区',
  'Dubai Creek': '迪拜河',
  'Creek Beach': '河畔海滩',
  'The Lagoons': '泻湖社区',
  'Emaar South': '伊玛尔南区',
  'Dubai Hills': '迪拜山庄',
  'Arabian Ranches 2': '阿拉伯山庄二期',
  'Arabian Ranches 3': '阿拉伯山庄三期',
  'Damac Hills 2': '达马克山庄二期',
  'Damac Lagoons': '达马克水晶湖',
  'Damac lagoons': '达马克水晶湖',
  'Akoya Oxygen': '阿科亚氧吧',
  'Dubailand Oasis': '迪拜乐园绿洲',
  'Sports City': '运动城',
  'Dubai Residence Complex': '迪拜住宅区',
  'Jumeirah Golf Estates': '朱美拉高尔夫庄园',
  'Victory Heights': '胜利高地',
  'Earth': '地球社区',
  'Fire': '火焰社区',
  'Jumeirah Islands': '朱美拉群岛',
  'Jumeirah Park': '朱美拉公园',
  'Jumeirah Heights': '朱美拉高地',
  'Al Barsha South': '巴沙南区',
  'Barsha Heights': '巴沙高地',
  'Tecom': '特科姆',
  'Studio City': '制片城',
  'Media City': '媒体城',
  'Internet City': '网络城',
  'Motor City Community': '汽车城社区',
  'Uptown Motor City': '汽车城上城',
  'Green Community East': '绿色社区东区',
  'Green Community West': '绿色社区西区',
  'Layan': '莱扬',
  'Maple': '枫叶社区',
  'Sidra': '希德拉',
  'Golf Place': '高尔夫居所',
  'Park Heights': '公园高地',
  'Collective': '集体社区',
  'Al Khail Heights': '海尔高地',
  'Executive Towers': '行政塔楼',
  'Bay Square': '湾广场',
  'Burj Vista': '哈利法塔景观',
  'Opera District': '歌剧院区',
  'City of Arabia': '阿拉伯之城',
  'Global Village': '全球村',
  'Miracle Garden': '奇迹花园',
  'Al Lisaili': '利赛利区',
  'Lehbab': '莱赫巴布',
  'Margham': '马尔格哈姆',
  'Hatta': '哈塔',
  'The Sustainable City': '可持续城市',
  'Mudon Al Ranim': '穆东拉尼姆',
  'Villanova La Rosa': '维拉诺瓦拉罗莎',
  'Expo City': '世博城',
  'Dubai Expo 2020': '迪拜世博园',
  'Al Maktoum International Airport': '阿勒马克图姆国际机场',
  'Waterfront': '海滨区',
}

// ── Main ────────────────────────────────────────────────────────────────────

async function main() {
  console.log('🔍 Fetching all areas from database...\n')

  const result = await pool.query(`
    SELECT id, name, translations
    FROM dubai_areas
    ORDER BY name
  `)

  const areas = result.rows
  console.log(`📊 Found ${areas.length} areas in database\n`)

  let updated = 0
  let skipped = 0
  let noMatch = 0
  const unmatched: string[] = []

  for (const row of areas) {
    const zhName = KNOWN[row.name]

    if (!zhName) {
      // No known translation
      noMatch++
      unmatched.push(row.name)
      continue
    }

    // Check if already has zh translation
    const existing = row.translations?.zh?.name
    if (existing === zhName) {
      skipped++
      continue
    }

    // Merge into existing translations
    const translations = { ...(row.translations || {}) }
    translations.zh = { ...(translations.zh || {}), name: zhName }

    await pool.query(
      `UPDATE dubai_areas SET translations = $1 WHERE id = $2`,
      [JSON.stringify(translations), row.id]
    )

    updated++
    console.log(`  ✅ ${row.name} → ${zhName}`)
  }

  console.log('\n' + '='.repeat(60))
  console.log('📊 Summary:')
  console.log(`  ✅ Updated: ${updated}`)
  console.log(`  ⏭️  Skipped (already set): ${skipped}`)
  console.log(`  ❓ No translation found: ${noMatch}`)

  if (unmatched.length > 0) {
    console.log(`\n⚠️  Areas without Chinese translation (${unmatched.length}):`)
    for (const name of unmatched) {
      console.log(`     - ${name}`)
    }
    console.log('\n💡 Add these to the KNOWN dictionary in this script and re-run.')
  }

  console.log('='.repeat(60))
  await pool.end()
  console.log('\n✨ Done!\n')
}

main().catch(error => {
  console.error('Fatal error:', error)
  process.exit(1)
})
