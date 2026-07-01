# POI 富化 — 状态与后续 pickup

> 起点:地图 POI 弹窗只有名称+导航(无照片/评分/介绍),根因是 OSM 数据源不提供、数据库无字段。
> 目标:让 POI 信息对客户有用,并打通到 AI(Luna 语音、项目详情页)。
> 最后更新:2026-06-30。相关 spec:`docs/poi-enrichment-spec.md`;选型:`docs/reports/2026-06-28-poi-enrichment-options.md`。

## ✅ 已完成并上线(全部验证过)

| 能力 | 说明 |
|---|---|
| 数据库 | `dubai_poi_enrichment` 表(description/description_zh/photo_url/photo_credit/khda_rating/khda_year/khda_url) |
| 懒加载端点 | `GET /api/dubai-pois/:id/details`(弹窗点开才拉) |
| 中文介绍 | **1545 个** POI(学校/大学/医院/诊所 + mall/park/bank/police/fire_station/mosque/gym/cinema),Wikipedia 摘要 + Gemini 生成 |
| 真实照片 | **92 个**(16 Wikipedia + 76 官网 og:image) |
| 图片 100% 覆盖 | 弹窗 heroSrc = 真实照片 → 卫星缩略图(Esri z=16) → emoji 兜底 |
| KHDA 官方评级 | **74 个**学校(6 卓越/21 优秀/33 良好/14 合格),弹窗徽章 + 「截至 2023-24」标注 |
| 弹窗 UI | media-object 布局(缩略图左 / 类型+标题右 / 描述通栏下),去掉无用通用针 |
| Luna 语音接入 | `get_pois_near_point()` JOIN enrichment → analyze_area_amenities / present_place 讲 KHDA 评级 + 学校/医院中文介绍;系统提示词允许(禁编造) |
| 项目详情页 | projectInsights 周边 JOIN enrichment,LocationTab 最近学校显 KHDA 徽章 |

### 关键文件/脚本(pickup 时看这些)
- 富化脚本:`backend/scripts/enrich-pois.ts`(介绍+Wikipedia照片)、`enrich-poi-photos.ts`(官网 og:image)、`import-khda-ratings.ts`(KHDA 评级) + `khda-ratings.json`(源数据)
- 后端:`src/routes/dubai-pois.ts`、`src/db/poi-enrichment-schema.sql`、`src/db/update-pois-near-enrichment.sql`、`src/services/voice-assistant-tools.ts`、`voice-assistant.ts`、`services/projectInsights.ts`
- 前端:`src/pages/MapPage.tsx`(弹窗)、`src/hooks/useDubaiPois.ts`、`src/pages/ProjectDetailPage/LocationTab.tsx`
- 重跑:`npx ts-node scripts/enrich-pois.ts`(非 force 跳已做)/`--force` 全重跑/`--limit N` 测

## ⏭️ 剩余可 pickup(按价值排序)

### P1. KHDA 覆盖 74 → 更高
- 现状天花板=74(whichschooladvisor name 匹配,精准优先)。
- **坐标级精确匹配**(最优):Dubai Pulse `khda_private_schools_erc` 含坐标+评级,但"CSV 直链"实际返回 HTML(需 session/API Key;已从迪拜盒子 38.54.8.9 curl 验证=HTML 墙)。→ 需申请 Dubai Pulse API Key+Secret,或人工导出。拿到坐标后按 POI 最近点匹配(比 name 稳)。
- **人工补**:往 `backend/scripts/khda-ratings.json` 加缺失学校 {name, rating},重跑 import。注意多校区歧义(如 Dubai International Academy:Emirates Hills 卓越 / Al Barsha 优秀 —— 别乱配)。
- KHDA 督导暂停至 **2026-27**,恢复后需刷新评级 + 改「截至」年份标注。

### P2. 更多真实照片
- 现 92 张;还有 ~97 个有官网但 og:image 没抓到,以及大量无官网的。
- 可加**免费**源:Wikimedia Commons 地理搜索图 / Mapillary 街景(需 token)。仍走"宁缺毋滥"——错图比无图伤信任。
- 目前无此需求可不做(卫星兜底已保证每个都有图)。

### P3. 通用类别写介绍(可选)
- restaurant(3071)/supermarket(1302)/cafe(804)/hotel(718)/pharmacy(353)/gas_station/atm **故意没写文字介绍**(单个价值低、Gemini 量大)。靠卫星图已有图。
- 若要做:改 `enrich-pois.ts` 的 CATEGORIES 加类别,重跑(非 force 跳已做)。

### P4. projectInsights 周边优先"最近的有评级学校"
- 现项目详情周边取**最近学校**(DISTINCT ON category),徽章只在最近那所恰好有评级时显示。
- 可改成优先展示最近的 KHDA 评级学校(SQL 需子查询/窗口),让徽章更常出现。Luna 工具已是这逻辑(≤5km),项目页未跟进。

### P5. 富化数据刷新机制
- 介绍/照片/评级都是**一次性**跑的,无定时刷新。POI 变动或数据过期需手动重跑脚本。
- 可选:加 systemd timer / cron 定期重跑(参考迪拜盒子 dubai-daily.timer 模式)。

### P6. Luna 讲更多类别介绍 + 医院类目清洗
- Luna 现只在结果里带 school+hospital 的介绍;mall/park 等 description 在库里但没喂给 Luna。可按需扩。
- **OSM 把部分诊所/培训中心误标成 `hospital` 类**(预存数据问题):影响便利度评分的"最近医院"和 Luna 的 nearest_hospital(如 Al Noor 残障培训中心)。介绍文字准确不误导,但如要精准可清洗 category 或加"真医院"过滤。

## 无 leftover 的确认
- 所有已完成项均已 commit + 部署(后端 quick-deploy、前端 Cloudflare push)+ 线上端点验证。
- 临时测试脚本(_test-luna-*.ts / _dev*.log)已清理,工作区无遗留。
- 自测:Luna 工具本地 harness 跑过 popular/偏远/不存在/项目 场景;工具声明一致性 check-voice-tools PASS;前后端 type-check 干净。
