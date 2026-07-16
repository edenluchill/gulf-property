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

## 5. 已定决策（2026-07-15 用户拍板）

1. **三元迁移 = `tt({...})` 内联桥接**（codemod + AI 批填）。
2. **范围 = 面向客户功能优先**（项目/对比/地图/AreaBlock/报价/home/nav/auth）；内部工具(admin/agent/editor/upload)后置。
3. **ru/fr 先上（LTR）；阿拉伯语 RTL 作为独立 P2 里程碑后做。**
4. **AI 翻译先上线，母语校对（尤其 ar）异步跟进替换。**

## 5b. 原待拍板项（存档）

1. **三元迁移策略**：`tt({...})` 内联桥接（快、可 codemod、AI 批填，**推荐**）vs 全量抽进 JSON t()（正规、但 542 处要逐个起 key、慢）。
2. **范围**：面向客户功能优先（项目/地图/对比/报价，**推荐**）vs 一次性全站（含 admin/agent/editor/upload 内部工具）。
3. **阿拉伯语 RTL**：先上 ru/fr（LTR、快），ar 作为独立 P2（**推荐**）vs 三语言一起上（等 RTL 做完再发）。
4. **翻译质量**：AI 翻译先上、母语校对异步跟进（**推荐**，迪拜市场速度优先）vs 母语校对完成再上线。

> 注：这是数周级工程，不是一次会话能全做完。建议先做 P0 地基（我可以直接开工），再按你选的范围逐 feature 推 P1。
