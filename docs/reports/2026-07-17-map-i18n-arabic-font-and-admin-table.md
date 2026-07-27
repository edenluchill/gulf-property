# 地图多语言(阿语字体)+ 项目管理页表格化 — 排查与实现报告

日期:2026-07-17

## 背景(用户三个诉求)

1. 地图上 area 名字还是英文,能不能支持其它语言。
2. 项目管理页(`/admin/properties`)只显示一页/20 个,"地图上有的项目管理里没有";页面要现代化、一次看更多、带 filter。
3. (后续)俄语/法语有些区还是英文;地标名也还是英文 —— "全做完"。

## 已完成并上线(可用)

### A. Admin 项目管理页 → 紧凑表格 ✅
- **根因**:后端列表接口默认 `limit=20` 且前端从不翻页 → 库里 41 个 verified 项目只显示最新 20 个,"地图有、管理里没有"就是这么来的;底部"20 projects total"数的是已加载行数,不是真 total。
- **改动**:`AdminPropertyListPage.tsx` 重写为紧凑表格,一次拉全量(`?limit=1000&verified=all`)、显示真实 total、状态/开发商/区域筛选 + 搜索。5 语言 locale 补键。
- 提交:`e0f2ff8`。**已验证类型/构建/i18n 裸键巡检通过**。

### B. 区域/地标名多语言数据 ✅
- **根因**:地图代码本就读 `translations[lang].name`(缺则回退英文),但数据里 231 个区只有 zh,ar/ru/fr 全空 → 非拉丁界面全回退英文。
- **脚本**:`backend/scripts/translate-area-names.ts`(走统一 `callGemini`),支持 `--table areas|landmarks|both`、`--langs`、`--force`、`--dry`。
- **已写库(生产)**:
  - 231 个区 + 15 个地标 全部补齐 ar/ru/fr。
  - 俄语强制全西里尔转写(0 个残留拉丁);阿语纯阿拉伯(去掉了 JVC/JLT/DMCC 等英文缩写括号);法语专有名词保留拉丁、通名翻译(Collines/Jardins/Île/par…)。
- **坑**:`jsonb_set(t,'{ar,name}',v,true)` 对**全新顶层键**会静默不改(只能建一层缺失键),必须 `jsonb_set(t,'{ar}',jsonb_build_object('name',v),true)`。

### C. 法语/俄语/中文地图区域名 ✅、地标阿语名 ✅
- 浏览器实测:法语区域名完美(Collines des Émirats、Ranches Arabes 3、Acres par Meraas…),俄语全西里尔,地标 DOM marker 阿语正常(برج العرب / مول الإمارات …)。

## 未完成/回退:阿语**区域(GL 标签)**名

### 根因(实测坐实)
- 地图区域名是 **MapLibre GL symbol 层**,字形来自**底图 style 的 glyphs 服务器**。
- 浅色/深色底图用的是 **CARTO**(`basemaps.cartocdn.com/.../voyager-*`),其字体服务器 **没有阿拉伯字形**(实测 fonts range 1536-1791 仅 ~50 字节=空,也没有 Noto)。只有**卫星底图**用的 openmaptiles 才有阿语。
- 中文能显示是靠 MapLibre `localIdeographFontFamily`(系统字体本地渲染 CJK),但那个机制**不覆盖阿拉伯文**。
- 所以补完 ar 数据后,阿语界面地图区域名从"英文"变成"**空白 + 拉丁括号 () (JVC)**"(拉丁字符渲染、阿拉伯字符渲染成空)。地标是 DOM marker 用系统字体,不受影响。

### 正确修法(概念已验证,代码未最终验证)
两件事缺一不可:
1. **字形**:把 CARTO 底图发出的、fontstack 含 Open Sans/Noto 的 glyph 请求,用 `transformRequest` 重定向到 openmaptiles(那里有阿语)。CARTO 自己底图标签用别的字体(Montserrat…)不受影响。
   - ⚠️ 已踩坑:正则 `/…cartocdn\.com)\/fonts\//` 吃掉了 `/fonts/` 尾斜杠,替换串必须自带 `/`,否则拼成 `openmaptiles.orgOpen Sans Bold` → 全部 404 → maplibre 逐码点疯狂重试刷几百条 warning。已在 `4b1c704` 修好。
2. **RTL 成形**:`setRTLTextPlugin`(自托管 `public/mapbox-gl-rtl-text.js`,0.3.0),否则阿语反向断字。

### 为什么回退了
- 在验证 `4b1c704`(含斜杠修复的 transformRequest + RTL)时,自动化 Chrome 实例的 renderer/GPU 被前一版的 glyph-404 刷屏**彻底 wedged**:此后**连"已知可用的会话前代码"在全新 tab 里也卡在加载**(mapObj 不出现、无瓦片请求、无报错),webgl 却正常。
- 即:"地图加载不出来"的信号是**坏浏览器**造成的,**不一定是代码**。为不拿用户线上冒险,已把地图代码回退到会话前可用版本(`3613b69`,live bundle `Dl9iUaFC`,已核实不含出错代码),并加一个兜底:**阿语界面地图 GL 区域标签暂回退英文**(空白比英文糟)。地标阿语、其它语言全部照常。

### 待办(下次在健康浏览器上做)
- 重新应用 `4b1c704` 的方案(transformRequest 斜杠版 + RTL 自托管 + text-font Noto 回退),**在健康浏览器实测**阿语区域名成形显示后再上线;去掉临时的"阿语→英文"兜底。
- 备选(更低风险):只做 transformRequest 字形重定向、不加全局 RTL 插件 —— 阿语字形可见但不成形(断字),难看但零全局风险。

## 提交记录
- `e0f2ff8` admin 表格 + i18n 数据脚本
- `70be404` text-font Noto 回退(不够,CARTO 无 Noto)
- `ca4ebae` glyphs 热替换 + RTL(**打断 onLoad,遮罩卡死**)
- `333c7b2` 改 transformRequest(**斜杠 bug → 404 刷屏**)
- `4b1c704` 斜杠修复(**可能是对的,但被坏浏览器误判**)
- `3613b69` 回退地图代码 + 阿语地图标签暂回退英文(**当前线上**)
