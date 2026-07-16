# 多语言框架 Spec — 2 语言 → 5 语言 (en/zh/ar/ru/fr)

> 日期：2026-07-15 · slug：`i18n-multilang-framework`
> 目标：在 en + zh-CN 基础上，支持 阿拉伯语(ar, **RTL**)、俄语(ru)、法语(fr)。
> 现状审计见本文件 §1（数据来自全仓审计）。

## 0. 一句话结论

现有 i18n 是"静态 UI 已入 react-i18next、其余四层全是硬编码双语"的半成品。扩到 5 语言的真实成本不在加 json，而在**去双语化**：
- **542 处 `zh ? 中 : 英` 内联三元 / 77 文件**（`startsWith('zh')` 遇第三语言静默走英文，不报错 —— 最大坑）
- **~942 条后端中文串 / 77 文件**（成品中文当 API 返回）
- DB 内容仅 zh/en；AI 生成默认中文、语言没稳定传到后端；RTL≈0
不能一次性大爆炸，必须**立护栏 + 工具化 + 分期**。

---

## 1. 现状（审计数字）

| 层 | 现状 | 规模 | 扩 5 语言工作量 |
|----|------|------|----------------|
| **A 静态 UI** | react-i18next 健康，en/zh 逐 key 一致 | 17 namespace × **1294 key/语言** | 低（量大机械，3 语言≈3882 条） |
| **B 内联三元** | `zh ? 中 : 英` 遍地 | **542 处 / 77 文件**（top: SalesOfferDialog 47、PaymentPlanSharePage 47、YieldVsArea 28、AreaInsightsPanel 25、PriceCheck 22） | **极高（核心成本）** |
| **C DB 内容** | `dubai_areas.translations` jsonb(zh/en) 229 区;POI `description_zh` 并列列 1545 条;散乱 `_ar`(DLD 原始) | 229 区 + 1545 POI，仅双语 | 中 |
| **D 后端中文串** | 成品中文当 API 返回;只有 1 处端点收用户语言 | **~942 条 / 77 文件**（market.ts verdictFor、area-classification…） | 高 |
| **E AI 生成** | 参数化/硬编码混杂，默认 zh;humanizeNumbers 只认 zh/en | 6+ 处 prompt 各写各的语言指令 | 中高 |
| **F 格式化+RTL** | money.ts `startsWith('zh')`→万/亿;RTL≈0（**203 物理边距 / 0 逻辑属性**，无 dir 动态，无 Tailwind RTL 插件） | — | RTL 独立大工程 |

配置：`frontend/src/i18n/index.ts`（react-i18next，无显式 supportedLngs，localStorage key=`pinzos-lang`，17 ns）。切换器 `LanguageSwitcher.tsx` 是**二值反转**（`zh?en:zh`）——5 语言下必须改成下拉。

---

## 2. 目标架构（North Star）

**一条铁律贯穿：任何一处都能拿到"当前用户语言"，且任何展示串都能按语言切换。**

### 2.1 语言解析单一入口
- **前端**：react-i18next 唯一真相（`pinzos-lang`）。ISO 码：`en/zh/ar/ru/fr`（内部把 `zh-CN`→`zh`）。
- **前端→后端**：所有 API 请求带 `Accept-Language`（在 fetch 封装层统一注入）。
- **后端**：`getLang(req)` 单一 helper（读 Accept-Language / `?lang=`，白名单+回退 en）。D、E 层全部从"写死"改成"注入"。
- **AI**：prompt 统一接收 `getLang(req)` 解析出的语言。

### 2.2 UI 串：两个共存的库，都必须 5 语言
- **中央 JSON（react-i18next）**：已入 key 的 1294 条 + 新功能。加 `locales/{ar,ru,fr}/`。
- **`tt({en,zh,ar,ru,fr})` 内联 helper**：**542 处三元的迁移目标**。codemod 把 `zh ? A : B` → `tt({zh:A, en:B})`，AI 再补 ar/ru/fr。co-located、可 AI 批填、日后可收进 JSON。
  ```ts
  // lib/tt.ts —— 组件内用(随 useTranslation 订阅重渲染);en 兜底
  export function tt(m: Partial<Record<'en'|'zh'|'ar'|'ru'|'fr', string>>): string {
    const l = (i18n.language || 'en'); const c = l.startsWith('zh') ? 'zh' : l.slice(0,2)
    return m[c] ?? m.en ?? m.zh ?? Object.values(m)[0] ?? ''
  }
  ```
- **护栏 lint 规则**：`no-restricted-syntax` 封杀新增 `startsWith('zh')` 和裸 `cond ? '中' : '英'` → 强制走 t() / tt()。**先立规则再迁移，防边改边漏**。

### 2.3 DB 内容：统一 `translations` jsonb（按 ISO 码）
- 全部内容翻译收敛到 `translations jsonb`，key = ISO 码：`{en,zh,ar,ru,fr}`。
- 废弃 `description_zh` 类并列列（POI）→ 迁进 jsonb。散乱 `_ar`(DLD 原始)保留只读，产品展示走 jsonb。
- **AI 回填管线**：扩 `gen-area-intros.ts` 产 5 语言 key;新建 `backfill-translations.ts`（Gemini 批翻 229 区 + 1545 POI × 3 新语言）;内容写入时挂**自动翻译 hook**（新区/新 POI 落库即补 5 语言）。
- 读取端把写死 `.zh`/`.en` 改成 `pickLang(translations, lang)`。

### 2.4 后端：返回**结构化 code+参数**，不返回成品文案
- 端点返回 `{ level:'high', premiumPct:77, ... }`，前端 t()/tt() 渲染（**价格体检、回报因子已是此范式**——照此改 area-classification、Luna 工具文案等 top 端点）。
- 无法结构化的（长叙述）→ 后端按 `getLang(req)` 查表 / 现生成。

### 2.5 AI 生成内容：按解析语言生成
- 统一：所有 prompt 从 `getLang(req)` 取语言，删掉写死的"全部用中文"。
- `humanizeNumbers` 等后处理按语言分支（ar/ru/fr 数字读法 + 千分位）。
- 覆盖：Luna 语音/文字、tour 生成、client-fit、report、property-analyzer、lunaSummary。

### 2.6 格式化：Intl per-locale
- `money.ts` 从 `startsWith('zh')` 双分支 → `Intl.NumberFormat(locale)` + per-locale 紧凑规则（zh 万/亿、en/fr/ru K/M/千分位、ar 视需求东阿拉伯数字）。
- 日期统一 `Intl.DateTimeFormat(locale)`。

### 2.7 RTL（阿拉伯语）：独立里程碑
- `<html dir>` 随语言动态（ar→rtl，其余 ltr）。
- 加 Tailwind RTL 支持 + **codemod 把 203 处物理属性 `ml-/mr-/pl-/pr-/left-/right-/text-left` → 逻辑 `ms-/me-/ps-/pe-/start-/end-/text-start`**。
- 镜像方向性图标/箭头;地图 UI（右缘 Luna 药丸、筛选 chips 贴左）按 dir 镜像。
- ru/fr 是 LTR，不等 RTL，先上。

---

## 3. 工具（让规模可控）
1. **三元 codemod**（ts-morph）：`cond ? 'A' : 'B'`(含 zh 判定) → `tt({zh:'A', en:'B'})`。机械可靠;跑完剩 AI 补 3 语言。
2. **AI 批翻脚本**（Gemini）：填 en→{ar,ru,fr}，作用于 ①JSON locales ②tt() 对象 ③DB jsonb。带术语表（迪拜地名/房产术语）+ 可选母语校对。
3. **逻辑属性 codemod**（RTL 期）：物理→逻辑 Tailwind 类。
4. **lint 护栏**：禁 `startsWith('zh')` / 裸双语三元。

---

## 4. 分期落地

### P0 · 地基 + 护栏（先做，1 个迭代）
- i18n 配置显式 5 语言 + fallback map;切换器改 5 语言下拉;`<html lang/dir>` 动态。
- `getLang(req)` + fetch 层统一发 `Accept-Language`。
- `tt()` helper + 三元 codemod + lint 护栏。
- `money.ts`/日期 → Intl per-locale。
- **产出**：框架就绪，可开始灌语言;新代码不再写双语三元。

### P1 · ru + fr 上线（面向客户优先）
- codemod 跑**面向客户**文件的三元 → tt()，AI 补 ru/fr（+ar 文本，留给 P2 布局）。优先级：项目详情/对比 tab、地图、AreaBlock、报价单、home/nav/auth。
- 中央 JSON AI 翻 ru/fr。
- 后端 top 端点结构化（area-classification 等，price-check 已完成）。
- DB `translations` 扩 ru/fr/ar + AI 回填 areas/POI。
- AI prompt 全部 lang-aware。
- **产出**：ru/fr 客户端可用（LTR）。

### P2 · 阿拉伯语 RTL
- 逻辑属性 codemod（203 处）+ `dir` 动态 + 图标/布局镜像 + RTL QA（414/1180/1440 三档 × RTL）。
- **产出**：ar 上线。

### P3 · 内部工具 + 母语校对
- admin / agent / editor / upload 的三元迁移（内部，可后置）。
- AI 翻译的母语（尤其 ar）人工校对。

---

## 4b. 进度 + 接续指南（2026-07-15，随时更新）

**已完成并上线：**
1. **地基**：`frontend/src/lib/tt.ts`(逃生舱,少用)、`backend/src/lib/lang.ts` `getLang(req)`、`track.ts` fetch 层注入 `Accept-Language`、`LanguageSwitcher.tsx` 5 语言下拉、i18n `<html lang/dir>` 动态(ar=rtl)。
2. **工业化工具**：
   - `backend/scripts/i18n-translate.ts` —— 读 `frontend/src/i18n/locales/en/<ns>.json` → Gemini 产 ar/ru/fr。用法 `npx ts-node -T scripts/i18n-translate.ts <ns...>|--all [--langs ar,ru] [--force]`。保留 key+`{{插值}}`。
   - `frontend/src/i18n/index.ts` 改 **`import.meta.glob('./locales/*/*.json')` 自动加载** —— 放 JSON 即生效,零配置。`ns` 也自动派生。
3. **全站 t() 键控 UI 已 5 语言**：19 命名空间 × {en,zh,ar,ru,fr} 全齐,key 与 en 一致。
4. **6 个组件内联三元已转 JSON**：`compare` ns(YieldVsAreaModule/PriceCheckModule/NearbyProjectsCompare/RecentDealsCompact/CompareTab)、`invest` ns(InvestmentScorecard)。
5. **AI 自动检测语言**:voice-token/public-router/property-analyzer/lunaSummary/client-fit-analyzer 改成"跟随用户语言",不写死中文。

**⭐ 工业化流水线(已验证,turnkey)—— 转一个组件 4 步：**
```
# 1. codemod 抽三元 → t('ns:key') + 写 en/zh JSON (先不 --write 干跑看报告)
cd frontend && node scripts/i18n-codemod.mjs src/path/File.tsx <ns> --write
# 2. 若报告"⚠ 需人工接",在组件顶部加 2 行(并删无用的 const zh=...):
#      const { t: tRaw, i18n } = useTranslation('<ns>')
#      const t = tRaw as (k: string, o?: Record<string, unknown>) => string
# 3. 补 ar/ru/fr (Gemini,~$0.04):
cd ../backend && npx ts-node -T scripts/i18n-translate.ts <ns> --force
# 4. 验:cd ../frontend && npx tsc --noEmit -p tsconfig.json  → 0 errors 才提交
```
codemod 安全:靠 CJK 判中英分支、只碰简单串、嵌套/复杂插值/歧义**跳过并报告**(人工处理),
key 去重(播种已有 key)。translate 自动剥 markdown 围栏。glob 自动加载新 JSON。
已用 TransactionsTab(15 串)+ compare/invest 手工样板验证。**剩 ~70 文件是重复这 4 步。**
新 ns 名建议 = 组件所属功能区(避免和大 ns 混)。

**转组件的标准配方(照此复制)：**
```
1. 组件顶部 const { t } = useTranslation('<ns>')；动态 key 用
   const tk = (k,o?) => (t as (k:string,o?:Record<string,unknown>)=>string)(`sub.${k}`, o)
2. 把 zh?'中':'英' 换成 t('key')；插值用 {{var}} + t('key',{var});
   注意:插值名别用 `count`(触发 i18next 复数,会 TS 报错)→ 用 n。
3. locales/en/<ns>.json + zh-CN/<ns>.json 写 en/zh;
4. 跑 backend/scripts/i18n-translate.ts <ns> 补 ar/ru/fr;
5. npx tsc --noEmit 验;glob 自动加载,无需改 index.ts。
```

---

# 📋 接手清单 (PICKUP —— 2026-07-15,下次直接从这里干)

## ✅✅ 轨道 A 已全部完成 (2026-07-15)

**所有面向客户 + 内部经纪台 + 内容页的 UI 串已迁到 `t()`,29 命名空间 × 5 语言全对齐,tsc 0 err。**
约 **1,900 个双语点 / 40+ 文件 / 15 commit** 清完。新增 ns:payplan/offer/areaInsights/
projectDetail/misc/gate/lunaTour/profile/roleSelect/about。

**两种双语模式都清了**:内联三元(`i18n-codemod.mjs`)+ `L('中','En')` 辅助函数
(**新写 `frontend/scripts/i18n-codemod-L.mjs`**,一次抽 388+ luna-tour + 290+ 小文件调用)。

**剩下的 ~65 处 `zh ?` 是「故意保留」,不是遗漏,别再去转**:
- `lib/generateProjectNotes.ts`(11)——生成散文,**该走后端 AI 按语言生成**(§轨道B),不是 static t()。
- `lib/metricPeriod.ts`(7)——`periodLabel` 返回 1M/3M/1Y **通用缩写**,zh 给中文、其余给 M/Y 缩写即可。
- `lib/tt.ts`(2)——tt() 逃生舱 helper **本身的实现**,必须保留。
- **数据驱动双语**:共享 badge(`badge.titleZh`,UserMenu/ProfileShell/ProfileHome/RoleSelect 各1处,跨文件数据源,改要动 `lib/roleBadge`)、luna-tour 的 `L(obj.label, obj.en)` 枚举 map(AgentClients/AgentBilling/AgentTours/CelebrationPoster/AiEditPanel 等)、LocationTab POI_META、GuidedTour STOP_META、AmenitiesTab meta.zh。
- **本地化资源/格式**:AboutPage 的 `zh?'/x.jpg':'/x-en.jpg'`(只有 zh/en 两版素材)、㎡/sqft 单位制选择(UnitTypesTab)、offer 存储 lang code、中文页专属 slogan。

**下一步 = 轨道 B(后端中文串)+ 轨道 C(阿语 RTL 布局)**,见下方。轨道 A 收工。

---

## 轨道 A(存档)：内联三元 → t()
**每个文件跑 §4b 的 4 步**(codemod --write → 若报警加 2 行 casted t + 删 const zh → translate --force → tsc 0 err → 提交)。ns 名 = 组件功能区。

**⚠️ codemod 会安全跳过的(需人工/单独处理,别硬转)**:
- **数据驱动双语**:`zh ? obj.titleZh : obj.titleEn`(如 RoleSelectPage、可能 luna-tour 报告卡)—— 这是数据结构里塞了 Zh/En 字段,要么改数据层要么保留,不是简单 t()。
- 嵌套三元 `zh ? a : cond2 ? b : c`、带函数调用的模板插值。

**worklist(按面向客户优先级;数字=三元数)**:
- ✅ 🔴 客户高频 **已全部完成(2026-07-15)** —— 18 文件,6 commit,tsc 0 err,5 语言齐:
  - `PaymentPlanSharePage`→**payplan** ns、`SalesOfferDialog`→**offer**、`AreaInsightsPanel`→**areaInsights**
  - 4 tab(Location/UnitTypes/PaymentPlan/Overview)+ 5 组件(BuyerConfidence/PaymentChart/PaymentTimeline/UnitEconomics/ReturnsBar)→ **projectDetail** ns
  - AreaDetailDialog/MapMarkers/MapPage/TransactionsPage/UserMenu/RoleBadgeDialog → **misc** ns
  - **本轮定的架构决策(继续时照抄)**:
    1. **文档/分享页语言锁定** —— PaymentPlanSharePage 的 `share.lang`、PaymentChart 等的 `lang` prop 是"文档语言"不是 UI 语言,一律用 `i18n.getFixedT(lang, ns)`(非响应式,不跟浏览者 UI 切),否则中文报价单被英文浏览器打开会变英文=回归。
    2. **大 ns 不碰** —— 新 key 进独立 ns(projectDetail/misc/areaInsights…),**绝不写进 map/project/transactions/auth 等大包**(translate 是整文件 --force 重翻,会 churn 已有译文)。
    3. **模块级 helper**(dist/quarterLabel 等)codemod 会把内部三元转成 `t()` 但那里没 `t` 作用域 → 把 `zh:boolean` 形参改成收 `t`,调用处传 `t`。
    4. 新 ns **必须**加进 `i18next.d.ts`(import + resources 两处),否则 `useTranslation('newns')` / 强类型 `t('newns:key')` TS 报错。
    5. **数据驱动双语保留**(`u.zh`/`roleChip.zh`/`badge.titleZh`)、㎡/sqft 单位制选择、本地化资源路径(jpg/mp4)—— 不是翻译,别硬转。
  - **AboutPage 仍待做(数据/资源驱动)**:6 处全是内容变量 `zh?cn:en` + 本地化资源路径,需内容层迁移(把双语内容搬 JSON 或 5 语言数据结构),非简单 codemod。
- ✅ 🟡 gate/infra **已完成(2026-07-15)** → **gate** ns:MapMeterGuard/GlobalQuotaGate/AppErrorBoundary(class,用 i18n.getFixedT)/VoiceAssistantButton(加 gate 多 ns)/GuidedTour(StopCard 子组件补 getFixedT)。**下一批从 🟢 或 ⚪ 起。**
- 🟢 内部/经纪台(可后置):luna-tour/*(AgentClients 18, AgentReport 10, AgentTours 8, ClientProfileWizard 11, AgentOverview 5, IntentFeed 5, CollabBar 7, AiEditPanel 3, AgentBilling 3, CelebrationPoster 4)、profile/ProfileShell(8) ProfileHome(5)
- ⚪ lib(是 label 函数,小心逻辑):`lib/metricPeriod.ts`(7,periodLabel 用 switch 不是三元,可能不用动) `lib/marketSegment.ts`(3,segmentLabel) `lib/generateProjectNotes.ts`(11,生成文本—考虑改后端 AI 按语言生成)
- 已完成(别重做):compare ns(YieldVsAreaModule/PriceCheckModule/NearbyProjectsCompare/RecentDealsCompact/CompareTab)、invest ns(InvestmentScorecard)、transactions ns(TransactionsTab)。
- **重扫命令**:`grep -rlE "zh \?|isZh \?" src --include=*.tsx --include=*.ts | while read f; do echo "$(grep -cE 'zh \?|isZh \?' "$f") $f"; done | sort -rn`

## 轨道 B：后端 ~942 条中文串 → 结构化 or 按语言产
- 病灶:`backend/src/routes/market.ts` `verdictFor()`(价格判断已在前端做了范式,可参考)、`/area-classification`(市场分级 tag/reasons 中文);`luna-tour/`(452 条,多是 AI prompt/报告,已随"AI 自动检测语言"缓解)、`services/`(284)。
- 做法:优先**返回 code+参数由前端 t() 渲染**(价格体检/回报因子已是此范式,照抄);长叙述用 `getLang(req)`(已有,`backend/src/lib/lang.ts`)查表或让 AI 按语言生成。
- 前端已全站发 `Accept-Language`(track.ts),后端 `getLang(req)` 拿得到。

## 轨道 C：阿拉伯语布局 RTL(独立里程碑,文本已就绪)
- 现状:`<html dir>` 已随语言切(ar=rtl,i18n/index.ts);文本全翻好。**缺的是布局镜像**。
- 做:**203 处物理 Tailwind → 逻辑属性** `ml-/mr-→ms-/me-`、`pl-/pr-→ps-/pe-`、`left-/right-→start-/end-`、`text-left→text-start`;方向性图标/箭头翻转;地图 UI(右缘 Luna 药丸、筛选 chips 贴左)按 dir 镜像。
- Tailwind 逻辑属性 v3 原生支持(ms-/me- 等);扫命令:`grep -rloE "\b(ml|mr|pl|pr)-[0-9]" src --include=*.tsx`。
- 建议专门一期 + 三档截图(414/1180/1440)× RTL 验。

## 工具/文件速查
- 翻译:`cd backend && npx ts-node -T scripts/i18n-translate.ts <ns...>|--all [--langs ar,ru,fr] [--force]`
- codemod:`cd frontend && node scripts/i18n-codemod.mjs <file> <ns> [--write]`
- i18n 配置:`frontend/src/i18n/index.ts`(glob 自动加载,不用改);类型 `i18next.d.ts`(新 ns 想要 t() 强类型才加,不加就用 casted t)
- 语言解析:前端 `lib/tt.ts`(逃生舱)、后端 `lib/lang.ts` `getLang(req)`
- **验证阻塞**:匿名地图额度 10min/天,我这轮用光了没法截图;登录用户不受限,可直接真机看。

## 5. 已定决策（2026-07-15 用户拍板）

1. **翻译入库 = JSON + `t()`（标准）** 〔**2026-07-15 修正**：原定 tt() 内联桥接，pilot 实测 5 语言内联对象把组件淹没、且母语校对得改 .tsx——改用 react-i18next JSON。组件里只留 `t('ns:key')`,翻译全在 `locales/<lang>/<ns>.json`,AI/校对只碰 JSON。codemod 自动生成 key,迁移不比 inline 慢。`tt({...})`(lib/tt.ts)降级为**极少数动态串的逃生舱**,不做主路径。**新语言的 JSON 资源块 + i18next.d.ts 类型 + ns 三处要同步**(见 i18n/index.ts 的 ar/ru/fr 块)。〕
2. **范围 = 面向客户功能优先**（项目/对比/地图/AreaBlock/报价/home/nav/auth）；内部工具(admin/agent/editor/upload)后置。
3. **ru/fr 先上（LTR）；阿拉伯语 RTL 作为独立 P2 里程碑后做。**
4. **AI 翻译先上线，母语校对（尤其 ar）异步跟进替换。**

## 5b. 原待拍板项（存档）

1. **三元迁移策略**：`tt({...})` 内联桥接（快、可 codemod、AI 批填，**推荐**）vs 全量抽进 JSON t()（正规、但 542 处要逐个起 key、慢）。
2. **范围**：面向客户功能优先（项目/地图/对比/报价，**推荐**）vs 一次性全站（含 admin/agent/editor/upload 内部工具）。
3. **阿拉伯语 RTL**：先上 ru/fr（LTR、快），ar 作为独立 P2（**推荐**）vs 三语言一起上（等 RTL 做完再发）。
4. **翻译质量**：AI 翻译先上、母语校对异步跟进（**推荐**，迪拜市场速度优先）vs 母语校对完成再上线。

> 注：这是数周级工程，不是一次会话能全做完。建议先做 P0 地基（我可以直接开工），再按你选的范围逐 feature 推 P1。
