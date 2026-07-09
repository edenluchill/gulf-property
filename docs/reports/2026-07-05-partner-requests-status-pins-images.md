# 2026-07-05 合伙人三项需求:销售状态 / 审核页图片操作 / 地图 pin 显示

来源:迪拜合伙人 WeChat(Eden 转达)。全部已上线(commit `a3731ca`,前端 Cloudflare Pages + 后端 quick-deploy + DB 迁移均完成)。

## 1. 审核页图片「调整顺序 / 选主图」选不了 —— 根因与修复

**根因**:功能一直都在(SortableImageGrid 支持拖拽排序 + 星标设主图),但 6/17 加「点击图片放大」后,所有操作按钮(星标/隐藏/拖拽把手)是 `opacity-0 group-hover` —— **只有鼠标 hover 才出现**。iPad/触屏没有 hover,轻点图片直接弹出大图 lightbox,按钮永远够不着。

**修复**:
- 星标 / 隐藏 / 拖拽把手改为常显(`SortableImageGrid.tsx`)。
- 共享 `ImageLightbox` 新增通用 `renderAction(currentIndex)` 插槽;审核页大图顶栏直接有「设为主图 / 已是主图」按钮 —— 全屏对比楼书页面时即可选封面。

**教训**:经纪全用 iPad,任何触屏页面禁用 hover-only 控件。

## 2. 销售状态五档(替换「已售罄」checkbox)

`DateTimeProgressSection` 的售罄勾选框升级为 pill 选择器:

| 值 | 中文 | 说明 |
|---|---|---|
| `upcoming` | 即将开盘 | 原有 |
| `selling` | 已开盘在售中 | **新增值** |
| `under-construction` | 建设中 | 原有 |
| `completed` | 已建成 | 原有 |
| `sold-out` | 已售罄 | 原有(选中时保留红色提示,建设进度条禁用) |

同步改动:
- **DB**:`residential_projects_status_check` 约束加 `selling`(`backend/src/db/add-selling-status.sql`,已在生产库执行)。
- **展示 6 处**:common.json(zh/en,upcoming 中文统一为「即将开盘」)、CollapsibleDetails、ProjectInfoCard、ProjectDetailPage 状态卡、AdminPropertyListPage、voice-token.ts Luna 提示词(selling = 可以买)。
- **类型**:frontend `types/index.ts` 两处 union、backend `types/residential-projects.ts` 两处。

注意:改 status 枚举必须 DB 迁移 + 上述 6 处展示一起动,否则新状态显示为原始英文串。

## 3. 地图 pin:常显项目名 + 两项目重叠不缩气泡

- `ProjectPinMarker` 泪滴下方常显项目名白色小药丸(absolute `top:100%`,不参与布局,pin 尖仍精确落坐标;max-width 140px 截断)。原 hover 才出现的名字 tooltip 移除。
- supercluster 结果中 `point_count === 2` 的组不再渲染数字气泡:`getLeaves` 拆成两个真 pin(带主图缩略+名字+SOLD 徽章),`map.project` 算像素距离 <52px 时沿两点连线对推(新 `pixelOffset` prop → Marker offset)。≥3 个项目仍是数字气泡,点击放大拆分。
- 生产截图验证:Palm Jebel Ali 上重叠的 Palm Central / Palm Central 2 已拆成双 pin 且都可点。

## 4. 付款计划:选户型 → 填实际报价 → 转发客户(/pp/:code)

合伙人第四项需求(同日下午):开发商开盘只给起价,楼层/朝向价格不同,经纪需要手填实际报价再生成付款计划转发客户。

- **经纪端**(详情页付款计划 tab 重做):
  - 30+ 户型药丸墙 → 按居室分组(起价 / 1居 / 2居 / …,各带最低价),组内可再下拉选具体型号;
  - 「② 填总价」输入框,预填所选户型价,可改成实际报价("已改为实际报价"角标),图表 + 每期金额即时换算;
  - 「转发给客户」→ POST `/api/luna/public/payplan` 落库 `lt_payment_shares` 生成短链 `/pp/:code`,移动端唤起系统分享,桌面复制。
- **客户端** `/pp/:code`(免登录、无 app 导航):项目 hero + 户型 chip + 大字总价 + 报价日期 + 付款时间线图 + 每期应付卡片 + 经纪联系卡(创建者是经纪时)+ 免责声明(以 SPA 为准)+ Pinzos 品牌。走 `/api/luna` 前缀,**不受地图额度计量**。
- **顺手修的隐藏 bug**:`payment_plan` JSONB 实际是 camelCase 键(`milestone/intervalMonths`),前端组件读 snake_case → 详情页时间线里程碑名一直是空的。新增 `lib/paymentPlan.ts normalizePaymentPlan()` 归一化两种形态,详情页与分享页共用。另修 PG numeric 字符串导致价格输入框显示 `1800000.00` 的问题。
- 端到端已验证(手机视口):选 2 居 → 填 2,888,000 → 生成 → 客户页正确显示;产线示例 https://www.pinzos.com/pp/ys7iaj 。

## 5. 「管理」下拉不显示(误以为今天改坏)+ 楼书上传权限

**下拉 bug 根因**:不是当天改动 —— 07-03 的滚动收纳把 `<Header/>` 包进 `grid-rows 0fr` 收纳行,那层**常驻 `overflow-hidden`** 把 header 里 absolute 定位的管理下拉整个裁掉(桌面 header 从不收纳却一直被裁)。修:只在收起时才 `overflow-hidden`(Layout.tsx)。

**uploader 权限层**(回答"能不能授权某个 email 上传楼书但不看 telemetry"):
- 身份矩阵现在是:买家 user / 经纪 agent(user_profiles.role)→ **uploader(新)** → admin(ADMIN_EMAILS)→ owner(lzp6529,分析/计费)。
- `upload_permissions` 表按 email 授权;uploader 可用「上传楼书 / 任务审核 / 项目管理」,看不到数据分析、地图编辑、经纪审批等(仍 admin/owner)。
- 授权入口:dashboard → 经纪审批 tab → 「楼书上传权限」卡片(输入邮箱授权/撤销)。
- 已直接授权合伙人的帮手 `tczhulei2001@msn.com`(蕾姐)—— 她登录后 header 会出现「管理」菜单(只有上传相关三项)。
- 端点:`GET /api/agents/can-upload`(自查)、`GET/POST/DELETE /api/agents/upload-permissions`(owner)。
- 已知安全债(存量,未在本轮修):后端 admin-tasks 是伪 header 校验、/submit 仅 requireAuth;真正的门在前端 ProtectedRoute。

## 6. 审核页手机版:源 PDF 收进 tab + 分区导航吸顶

- 顶部「源 PDF」横幅(6 个文件手机占满一屏)移除 → 变成工作台分区导航最后一个「源 PDF」tab(带数量角标),PropertyWorkspace 新增可选 `pdfLinks` prop(仅任务审核页传)。
- 手机分区导航重做(SectionNav):**吸顶**(sticky top-0,滚动中始终可见)+ 白色分段条卡片化 + 激活项 teal 高亮阴影 + 右缘渐隐提示可横滑 + 选中项自动 scrollIntoView 居中。原来的松散 chips 一滚就不见,很难察觉。

## 验证与部署

- 前后端 `tsc --noEmit` 通过;前端 `npm run build` 通过。
- 本地截图验证注意:**生产 api.pinzos.com 对 localhost 有 CORS 拦截**,必须 `cd backend && npm run dev`(本地后端连生产库)+ vite 5174。
- 前端:push 即部署(本次 ~1 分钟出新 buildId `mr7kb0e7`);后端:`quick-deploy.ps1 -SkipWorker`(Luna 提示词变更)。
