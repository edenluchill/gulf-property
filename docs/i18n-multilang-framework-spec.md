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

# 📋 接手清单 (PICKUP —— 2026-07-16,下次直接从这里干)

## ✅✅ 轨道 C 代码部分全部完成 (2026-07-16),剩截图验收

RTL 的**全部代码改动已落地**,6 个 commit。`tsc 0 / build 0`,且每批都验证过
产物 CSS 真生成了对应类(逻辑属性/rtl: 变体都**不会静默失效**)。

| 批次 | 内容 | 量 |
|---|---|---|
| C-3 | `rounded-l/r→s/e`、`border-l/r→s/e`、`space-x` 补 `rtl:space-x-reverse` | 58 token / 21 文件 |
| C-1 | `left-/right- → start-/end-` | 131 token / 50 文件 |
| C-2 | 方向性图标补 `rtl:-scale-x-100` | 53 图标 / 27 文件 |
| C-5 | 功能性渐变 + `origin-*` 手动 `rtl:` 镜像 | 3 处 |
| C-1(地图) | 地图 UI 镜像 + **uiBlocks 裸像素禁区**镜像 | 17 token + JS |

**新工具**(都幂等、都只改字符串字面量不碰注释):
- `frontend/scripts/i18n-rtl-logical.mjs --phase2` —— 边角/边框/间距
- `frontend/scripts/i18n-rtl-position.mjs` —— 定位(带三类启发式,见下)
- `frontend/scripts/i18n-rtl-icons.mjs` —— 方向图标

### ⚠️ 这轮踩到的坑(再动 RTL 前必读)

1. **`left-1/2 -translate-x-1/2` 是「居中」不是「靠左」,绝不能转**(保留 18 处)。
   transform 不随 dir 翻转 → 它在 RTL 下本来就居中。转成 `start-1/2` 后 RTL 下
   `start`=`right`,元素右缘落在中心再左移半身位 → **直接偏出中心**。
   `left-0 right-0` 成对 = 横向撑满,方向无关,转了纯噪音(保留 34 处)。
2. **`rtl:rotate-180` 对斜箭头是错的**。`ArrowUpRight + rotate-180` = 左**下**箭头。
   必须用 `-scale-x-100`(只镜像水平轴)→ 左**上**。统一用镜像,一个规则覆盖所有方向。
3. **图标翻不翻,看它表达的是「方向」还是「物体」**。工具图标不翻 ——
   本仓库唯一一例:CollabDrawToolbar 的「画箭头工具」图示(已在脚本 EXCLUDE 里)。
4. **`rtl-keep` 豁免机制**:元素上方 6 行内写 `rtl-keep`,codemod 整个跳过。
   用于**命令式定位** —— MapViewMapLibre 的圆点 hover 提示靠 JS 写
   `transform:translate(x,y)`,x 恒从容器**左**缘算(`e.point.x`,与 dir 无关)。
   换成 `start-0` 后 RTL 变 `right:0` 叠加正 x → 提示飞出屏幕。
   (判断靠 AST 找所属 JSX 元素再回溯注释,不靠脆弱的行距。)
5. **codemod 看不见 JS 里的裸像素**。`MapViewMapLibre.recomputeCards()` 的
   `uiBlocks` 是硬编码禁区坐标,Tailwind 把浮层镜像走了它不会跟着动 →
   卡片去躲空气、然后压在真浮层底下。**已修**:坐标统一按 LTR 写,RTL 时整体
   翻转 `x0'=W-x1`;`i18n.language` 已进依赖数组(否则切语言不重算=等于没镜像)。
6. **Tailwind 对这几类没有逻辑属性,只能 `rtl:` 手动镜像**:
   `bg-gradient-to-*`、`origin-*`。全站扫下来功能性的只有 3 处(已修);
   另 114 处 `to-r`/`to-br` 是装饰性按钮/卡片渐变,**有意跳过**(RTL 不镜像无妨)。

### ✅ 轨道 C-4 已完成(2026-07-16)· 并且做成了可重跑的工具

**别再用人眼扫几十张图 —— 必然漏。两个脚本:**
- `frontend/scripts/rtl-audit.mjs` —— 切阿语,关键页 × **手机414/平板1180/桌面1440**,
  自动抓:**横向溢出**(RTL 最典型的坏法,还会打印是哪个元素撑宽的)、漏翻的裸键、
  残留 CJK、`html dir`、JS 错误。用法 `node scripts/rtl-audit.mjs [路由]`。
- `frontend/scripts/rtl-doc-lock-check.mjs` —— **用阿语浏览器打开 lang=zh 的报告,
  页面必须纹丝不动保持中文**。这是用普通 `useTranslation` 就会犯的错,
  且只有切到别的语言才看得见。

**巡检结果**:12/12 页×档全绿;`/cr/demo` 在阿语浏览器下 mobile+pad 均保持中文 LTR。

**它抓到的两个真问题(人眼扫图看不出来)**:
1. **定价页功能名恒为中文** —— `credits.ts` 的 `FEATURES[].label` 是中文,
   `PricingPage` 直接渲染 `f.label`;旁边的 `labelEn` **从来没人读**(没接线的开关)。
   `AgentBilling` 更隐蔽:`zh ? f.label : (f.labelEn || f.label)` —— 只有中英两版。
   已修:后端只送 `key`,前端 `t('pricing:feature.<key>')`(新 `pricing` ns × 5 语言)。
2. **中文报告在给客户看阿拉伯语地标名** —— 见下方「地名防线」。

**仍需人眼扫一眼的**:VoiceAssistantButton 的 `rotate-45` 气泡尖角
(旋转不随 dir 变,`border-t border-e` 镜像后尖角朝向)、导览对比卡 5 列在 RTL 下的语序。

### ⭐ 地名防线(placeNameUsable)—— 任何把地名给用户看的地方都要过

`dubai_pois.name` 混着中文/拉丁/**阿拉伯原名**。不挡的话:
- 一份中文报告的「周边」chips 写着「دبي مول / برج خليفة · 3.6km」,客户一个字看不懂;
- 更糟:demo 里「🚇 地铁(صيدلية لايف)」—— 那其实是「Life Pharmacy」,
  **一家药房被当成地铁站念给客户听**。

防线原本只长在 `luna-tour/session-builder`(导览),**报告链路一直没有**。
现已提到 `backend/src/lib/lang.ts` 的 `placeNameUsable()` 共用,
前端镜像在 `frontend/src/lib/tt.ts`(两边判据必须一致)。
- **生成时过滤(必须)**:AI 也吃 `nearby.name`,不挡它会把阿拉伯名字念进中文散文。
- **渲染时再挡一道**:DB 里的存量报告是在这之前生成的、名字已烤进 jsonb。
- 名字不可读 → 退回品类(`clientReport:poiCat.*`,23 个);连品类都没有 → 整条不显示。

**⚠️ 差点引入的 bug**:`radarScores` 也吃 `nearby`。拿**过滤后**的去算,会因为
"地铁站的名字是阿拉伯文"把它整条丢掉 →「生活配套」分平白变低。
已分成两份:**评分用未过滤的,展示用过滤后的**。展示层的过滤绝不能改变评分。

---

## 轨道 B 进展 (2026-07-16)

**真实范围 ≈ 312 条,不是 4599。** 4599 里绝大部分是**中文注释**(保留是好事)
和**给 Gemini 的 prompt**(中文写、AI 按用户语言输出,本就不用管)。

### ✅ 批 0 已完成 —— 零翻译成本那批

**① 解「反向影子」(11 处,`51b1aaa`)** —— 这是整个轨道 B 性价比最高的一批。
调用点写成 `d.error || t('lunaTour:editFailed')`:翻译键早写好、5 语言也齐,
但后端一送中文 `error`,`||` **当场短路,译文永远走不到**。
修法(沿用 `agent-router:172` 已有范式 `{ error:'请先登录', code:'auth_required' }`):
- 后端 13 处中文 error 补 `code`;`error` 字段保留 → **给日志/调试看**。
- 新 `frontend/src/luna-tour/errText.ts`:认 `code` 查 `lunaTour:err.<code>`,
  没有就回退调用点自己的 key。**前端永远不显示 `d.error`**。
- 14 个 `err.*` 键 × 5 语言齐。

**② `CAMERA_STYLES.label`(3 条死串,`c2b4a9f`)** —— 精确删掉 label 字段。

> ⚠️ **侦察报告的两条结论是错的,已核实修正**:
> - `CAMERA_STYLES` **不是**纯死代码(agent-router:2174 活着),死的只有 `label` 字段。
> - agent-router 的 8 条「版本备注」**不是该删的死串**。前端 undo 确实丢弃响应体
>   (`await` 无 `.json()`),但这些串是写进 DB 的**审计轨迹**,删了等于毁记录。
>   正确处置 = 归类为内部串、不翻译。

**③ 修了一个真 bug(`01740ed`)** —— `OverlayLayer` 用
`p.distances.find(d => d.label.includes('地铁'))` 找地铁,即**把展示文案当数据键**。
label 随 tour 语言变 → 换语言后匹配返回 undefined,导览卡的地铁行**静默消失**。
轨道 B 一推进必然引爆。修:后端本就有结构化 `AMENITY_SPECS.cat`,只是没往前端送;
现在 `distances[].cat` 带上,前端认 cat 不认 label。
**`cat` 标 optional 且保留旧匹配兜底 —— tour session 持久化在 DB,历史 session
没这字段,不留兜底就是修一个 bug 造一个。**

### 🔧 工具链升级:`i18n-translate.ts --missing`

以前只有两档:默认**整个跳过**(一个键都加不进) / `--force` **整个重翻**
(churn 掉已校对的译文)。所以 spec 之前只能建议"新键塞进独立小 ns"来绕开 ——
**那是在绕工具缺陷,不是设计**。
现在 `--missing` 只翻 en 有、目标缺的键,再深合并回去(已有键优先)。
实测 lunaTour(473 键)加 14 个 err 键:ar/ru/fr **+48 insertions / 0 deletions**,
已有译文一条没动,成本 $0.04。**大 ns 现在可以放心加键了。**

### 🔴 轨道 B 剩余 —— 按优先级

**✅ P0 已完成(2026-07-16)· 三个「分享给客户」的页 —— 轨道 A 的真漏网**

轨道 A 自称"全部完成",但这三个**发给客户看**的页从没被迁过,100% 中文:

| 页 | 路由 | 结果 |
|---|---|---|
| `ClientReportPage` | `/cr/:code` 客户分析报告 | `clientReport` ns · 98 键 × 5 语言 |
| `ProjectReportPage` | `/r/:code` 经纪品牌报告 | `projectReport` ns · 39 键 × 5 语言 |
| `OverlayLayer` | 导览浮层(客户直接看) | `lunaTour:tourOverlay` · +25 键 |

**⭐ 三页的语言模型各不相同 —— 加新页前先想清楚属于哪种:**
1. **锁 lang**(ClientReportPage):正文是 AI 生成后存 jsonb,**语言在生成那刻定死**。
   `getFixedT(report.lang)`。跟 UI 语言切 = 「阿语标签 + 中文正文」,比全中文更糟。
   另需**容器级 `dir`** —— `<html dir>` 跟的是 UI 语言,英文 UI 打开阿语报告会
   正文阿语但版面 LTR。
2. **跟 UI 语言**(ProjectReportPage):`lt_project_reports` 只存 project_id/title/品牌,
   **没有 AI 正文**,端点纯数据 → 没有被冻结的语言,跟 UI 走才对。
3. **借现成机制**(OverlayLayer):`TourOverlay.tsx:162` 打开 tour 时已全局把
   `i18n.language` 切成 tour 的语言、卸载还原 → 普通 `useTranslation` 即可,别另造。

**已落地的 lang 链路**:`lt_client_reports.lang`(CHECK,默认 zh)→ 经纪台
`AgentReport` 语言下拉(默认=经纪 UI 语言)→ `langInstruction(lang)` 注入 prompt
→ public 端点回传 lang → 前端 `getFixedT`。
`LanguageSwitcher` 的 `LANGS` 已导出复用(单一真相源)。

**⚠️ 「AI 自动检测语言」在这里是主动错的,别再用。** 喂给模型的画像是**经纪**填的
(wizard 选项本身就是中文)→ 自动检测检到的是**经纪**的语言。俄罗斯客户收到中文
报告就是这么来的。`lib/lang.ts` 的 `langInstruction()` 注释里写死了这条。

**✅ P1 已完成(2026-07-16)**
- `session-builder` 的户型 label:`lang==='en'?...:中文` + 调用处
  `lang.startsWith('en')?'en':'zh'` **把 5 语言塌缩成 zh|en**。已删 label
  (bedrooms 本就在同一对象里),交前端 t()。类型标 `@deprecated` + optional
  (**DB 历史 session 的 jsonb 还带着它**)。
- `market.ts`:`verdictFor()` 的 label/explanation + price-check 的 summary/methodology
  = **死负载**(算完、传过网络、被整个丢弃 —— 前端早就读 level 自己 t())→ 删。
  `/area-classification` 的 label/perspective = tag 的一一映射 → 删,前端按 tag 出 t();
  reasons → `{ code, params }`;`/area-compare` 的整句中文 summary →
  `{ yieldWinner, growthWinner }`(拼句子是展示不是数据,中文语序不适用于其他 4 语)。
- `profileToOneLiner()` **保留** —— 它喂 AI prompt(数据输入,不是展示)。展示侧改走
  report jsonb 的 `profile_struct` 结构化字段 + 前端枚举白名单渲染。

**⚠️ 两个反复出现的教训**
1. **前端类型是手写的、不从后端派生** → 后端删字段时 **tsc 不报错**,运行时才空白。
   改后端契约**必须**手动同步 `lib/api.ts` 的类型,让编译器把破绽指出来。
2. **后端的中文别当插值塞进译文** —— `t('filter.tag', { label })` 里的 `label` 是后端
   的中文,于是中文漏进了已经翻好的译文里。

---

# 🔲 剩余 worklist(2026-07-16 实扫,下个 session 从这儿开工)

扫法(别凭记忆报数,注释会把数字虚高一个量级):
```
node <scratchpad>/gap.mjs      # 见下方脚本;或重写:剥注释后按「有无 useTranslation」分桶
```

## ✅ ① 面向经纪、零 i18n 的页 —— **已完成(2026-07-16)**

5 个文件全部迁完,`tsc 0 / build 0`,**143 个引用键 × 5 语言逐一验证命中**
(含 6 个 `kind` / 3 个 `camera` / 3 个 `gen.stage` 运行时拼的动态键 —— 正则抓不到,
手工枚举断言了)。

| 文件 | ns | 语言模型 |
|---|---|---|
| `TourEditor.tsx` | `lunaTour:editor.*`(58 键) | ③ 跟 UI |
| `GenerationProgress.tsx` | `lunaTour:gen.*` | ③ 跟 UI |
| `CollabDrawToolbar.tsx` | `lunaTour:draw.*` | ③ 跟 UI |
| `AgentCardEditor.tsx` | `profile:agentCardEditor.*` | ③ 跟 UI |
| `FactSheet.tsx` | **新 `factSheet` ns**(39 键) | **① 锁 lang** |

**⭐ FactSheet 的归类要改**:spec 原来把它算作「面向经纪」,但 `/factsheet/:code` 是
经纪**递给客户**的可核查文档,payload 里本来就有 `language`。跟 UI 语言走 = 中文导览的
清单被英文浏览器打开变英文 —— 就是 ClientReportPage 那条教训。已按模型 ① 处理:
`getFixedT(data.language)` + **容器级 `dir`**(`<html dir>` 跟的是 UI 语言,挡不住)。

`KIND_ZH` 按预定的模型 ③ 处理:map 删掉,改 `KINDS` Set + `t('editor.kind.<k>')`,
未知 kind 回退裸值(而不是渲染空白)。

### 🔴 这轮踩到的四个坑(比 i18n 本身值钱)

1. **`profile` ns 里 `agentCard` 撞名 —— 静默毁掉一个在用的键。**
   profile 本来就有扁平键 `agentCard: "Agent card"`(`ProfileHome.tsx:160` 在渲染它)。
   我加了个 `agentCard.*` 组 → 深合并把那个字符串**冲成了对象**;
   更隐蔽的是 `i18n-translate --missing` 的 `unflatten({...gotFlat, ...existingFlat})`:
   扁平键 `agentCard` 排在 `agentCard.title` 后面 → **把刚翻好的对象覆盖成字符串**,
   而校验只比对 key 存不存在,**一句警告都不报**。
   已改名 `agentCardEditor.*`。**加组名前先确认同名扁平键不存在。**
2. **`TourUnit.label` 是「手抄类型没跟上后端」的现行案例**(即下方教训 #1)。
   后端 `TourPropertyUnit.label` 早已 `@deprecated` 不再产,前端类型仍写着必填 `string`
   → **tsc 不报错,FactSheet 的户型行对新导览直接渲染空白**。
   已把前端类型改 optional + `@deprecated`,户型名改从 `bedrooms` 现算
   (`units.studio` / `units.nBed`,同 OverlayLayer 范式)。
3. **`d.message` 上还有三处「反向影子」** —— 批 0 只堵了 `d.error`。
   `AiEditPanel:101` / `AgentTours:1187` / `TourEditor:217` 全是
   `d.message || t(...)`,后端一送中文 message 就短路。
   已给两个端点补 `code`(`ai_no_changes` / `ai_nothing_to_change`)+ 三处改走 `errText()`。
   **教训:反向影子不只长在 `error` 字段上,任何「后端送人话 + `||` 兜底」都是。**
4. **翻完标签,数据行仍是中文** —— 见下方 ⑦。

### 🔧 新工具:`frontend/scripts/i18n-key-check.mjs` —— **加键改键必跑**

`node scripts/i18n-key-check.mjs` —— 扫全站 `t()` 静态键,断言**每个键在 5 语言里
都解析得出字符串**。i18next 找不到译文时**不报错、原样把 key 吐到界面上**,tsc 也拦不住
(动态键全 cast 成 string)—— 这类 bug 只有真人在那个语言下走到那个分支才看得见。
现状:**1942 键 × 5 语言全绿**。

它当场抓到一个真 bug:`AgentReport.tsx:234` 的 `t('lunaTour:reportLang')` **键根本不存在**
→ 报告语言下拉的标签在 5 种语言下**都显示字面量「lunaTour:reportLang」**。
(是 P0 那批加的,人眼扫图扫过去了。)已补键。

**写这个工具时自己踩的假阳性,规则里都得放过**(三轮才收敛到 0):
- **复数键**:传 `{count}` 时 i18next 查 `key_one`/`key_other`(阿语还有 `_zero/_two/_few/_many`),
  裸 `key` 本就不存在 → 第一版报了 **115 处全是假的**。
  *整齐的 100% 失败 = 规则错了,不是数据错了。*
- **默认值**:`t('k','Default')` / `t('k',{defaultValue:'x'})` 缺键也不露 key(但 ar/ru/fr 会看到英文 —— 属降级,不属裸键)。
- **注释里的示例**:`// 走 t('compare:yieldVsArea.KEY')` 是文档不是调用 → 必须先剥注释。
- **动态键是盲区**:`t(\`editor.kind.${k}\`)` 正则抓不到 → 脚本里 `DYNAMIC` 手工枚举。**加动态键就来补一条。**

### ⚠️ 未做:rtl-audit 够不着这批页
`rtl-audit.mjs` 要能匿名打开 URL;这 5 个页要登录 / 真实 session / share code。
裸键这条主要坏法由上面的 key-check 兜住了,但**横向溢出/版面**没自动验过 ——
TourEditor 的时间线值得人眼看一眼(它靠 inline `left: start*px` 定位,
**整条时间线在 RTL 下不镜像**,这是有意的:`←/→` 移动按钮的文案已按
「前移/后移」写,不按左/右)。

## ② `{zh, en}` 两语言数据表(~100 行)—— ar/ru/fr 用户看到的是**英文**
形如 `{zh ? meta.zh : meta.en}`。**只有两版**,阿/俄/法用户全部落到英文。

- `lib/amenityCategory.ts` `CATEGORY_META`(17)→ 消费方 `AmenitiesTab.tsx:48`
- `lib/roleBadge.ts` `titleZh/titleEn`(18)→ UserMenu/ProfileShell/ProfileHome/RoleSelect
- `pages/MapPage.tsx` `{ v:'all', zh:'全部', en:'All' }`(29)
- `luna-tour/pages/AgentClients.tsx` `{ key:'new', label:'新客', en:'New' }`(18)
- `lib/progress-i18n.ts`(11)

> ⚠️ **这批之前被 spec 标成「数据驱动双语,有意保留」—— 那个判断要修正。**
> 当时的理由是「codemod 转不了」,不是「不该翻」。结论:**该翻**,只是得手工
> 把 map 的 `{zh,en}` 换成 key + 5 语言 JSON。降级不算坏(有英文兜底),
> 但离「5 语言齐」差这一块。

## ③ 错误/兜底串
`lib/billingApi.ts`(16,`'网络错误,请重试'` 等)、`luna-tour/collab/useCollabVoice.ts`(11)、
`pages/ProjectDetailPage.tsx` 的几个 `alert()`。走 `errText()` 范式或直接 t()。

## ④ 后端经纪端问卷(~97)
`client-profile-coach.ts` 的 wizard 问题串。面向经纪。

## ⑦ 🔴 tour 快照里烤死的中文(桶① 挖出来的,归轨道 B)—— **翻了标签也没用**

`session-builder.ts` 把**中文**写进 `lt_session_properties.snapshot` 的 jsonb,
于是英/阿/俄/法的导览里,数据行照样是中文。FactSheet 和 OverlayLayer 都中招:

| 位置 | 现状 | 后果 |
|---|---|---|
| `session-builder.ts:117` | `label = \`${s.emoji} ${s.zh}（${name}）\`` | `AMENITY_SPECS` **只有 `zh` 一个分支** → 阿语导览的配套行写着「🚇 地铁」 |
| `session-builder.ts:62` | `tierOf()` 返回 `优秀/良好/一般/偏远` | `amenity_tier` 直接显示在 FactSheet / OverlayLayer |

**这不是漏翻,是把展示文案当数据存**(同 `distances[].cat` 那个 bug 的病根)。
正解照抄 `cat` 的范式 —— 后端送**结构化真值**,前端 t():
- `distances.push({ cat, name: nameUsable(hit.name, lang) ? hit.name : null, ... })`
  → 前端按 `cat` 出品类词、`name` 有才拼专名。`label` 保留兜底(**DB 历史 session
  的 jsonb 里只有 label**,不留兜底就是修一个 bug 造一个 —— 同 `cat` 那次)。
- `tierOf()` 返回 code(`excellent/good/fair/remote`);两个展示点 t(),
  AI prompt(`tour-generator.ts:70`)吃 code 无妨。历史 session 的中文 tier
  认不出 code → 原样显示。

⚠️ 动这里**必须**:`quick-deploy.ps1` → `backend/scripts/tour-e2e.ts` 跑分
(24 条内容体检,见 CLAUDE.md)。桶① 没做它就是因为这条链子比 i18n 长得多。

## ⑤ 真·有意保留 —— 别去动
- **AI prompt**(后端 ~1,400 行,大头是 `langgraph/agents/*` 的 PDF 抽取提示词):
  中文写、模型按注入的语言输出。动它反而会伤抽取质量。
- **owner-only 后台**(前端 526 行 / 31 文件:`components/analytics/*`、`AdminAnalytics` 等):
  §5 决策 #2 明确后置。
- `lib/generateProjectNotes.ts`(21):生成散文,该走后端 AI 按语言生成,不是 static t()。
- `lib/metricPeriod.ts`(7):1M/3M/1Y 通用缩写。`lib/tt.ts`(2):helper 本体。
- 测试夹具(`collab.test.ts` 的 `'李先生'` 等)。

## ⑥ 已知细节债
- **阿语 `nBed` 复数**:阿语 1/2/3-10 各有形态(غرفة/غرفتان/غرف),要走 i18next 的
  `_one/_two/_few/_other`。现统一 `{{n}} غرف نوم`。
- **`toLocaleString()` 裸调**会跟浏览器 locale 走(阿语环境可能渲染成 ١٢٣),
  与走 `'en-US'` 的金额前后打架。迁移前就有,未统一。
- **阿语译文全是 AI 产的,无母语校对**(§5 决策 #4 允许,但质量无人背书)。
- 人眼未扫:VoiceAssistantButton 的 `rotate-45` 气泡尖角、导览对比卡 5 列 RTL 语序。

**⚪ 有意后置 · owner-only 后台(~470 条)**
`components/analytics/*`(12 个 tab)、`AdminAnalytics.tsx`、`PerfMonitor` 等。
按 §5 决策 #2「内部工具后置」,**这不算漏**。

---

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
- 现状:`<html dir>` 已随语言切(ar=rtl);文本全翻好;**语言下拉阿语行反位 bug 已修**。
- ✅ **安全子集已完成(2026-07-15)**:411 token / 97 文件,`ml/mr→ms/me`、`pl/pr→ps/pe`、`text-left/right→text-start/end`。工具 `frontend/scripts/i18n-rtl-logical.mjs`(只改字符串内 token,不碰注释)。**逻辑属性在 LTR 下=物理属性,零回归**;阿语自动镜像。tsc 0。
- 🔲 **剩下的(需 RTL 视觉判断,别机械转)**:
  - **`left-/right-` 绝对定位**(182 处)—— 多数该镜像(Luna 药丸右缘、下拉 `right-0`、筛选 chips),但部分是刻意锁边;要 `start-/end-` 或 `rtl:` 变体,逐个看。
  - **方向性图标**:`ChevronRight/ChevronLeft/ArrowRight/ArrowLeft`(返回/下一步/展开箭头)在 RTL 要翻转 —— 用 `rtl:rotate-180` 或按 dir 换组件。
  - `rounded-l/r`(10)、`border-l/r`(37)——视觉边角,低优先。
  - `space-x-*` 在 RTL 顺序:Tailwind 的 `space-x` 用 `rtl:space-x-reverse` 或改 `gap`。
  - 地图 UI(右缘药丸、chips 贴左)整体按 dir 镜像。
- 建议专门一期 + 三档截图(414/1180/1440)× 切到阿语验。**登录用户不受匿名地图额度限制,可真机直接看阿语。**

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
