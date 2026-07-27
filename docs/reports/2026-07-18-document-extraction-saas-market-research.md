# 文档抽取方向 SaaS 市场研究（2026-07-18）

约束：一人做、自助订阅、$5-20k MRR、北美市场。
核心资产：9,600 行多 agent 楼书理解流水线（10 agent / Page Registry / 图实体匹配 / 一页多户型切分）。

---

## 第一部分结论：横向"文档抽取"已被商品化，别做

### 玩家密度（同一赛道，且多数拿了钱）
Reducto（$24M A 轮）、Extend（YC W23）、Pulse（YC W24）、OmniAI（YC W24）、
Unstructured、LlamaParse/LlamaIndex、Datalab(Marker)、Mathpix、Docling（IBM 开源免费）、
Azure Document Intelligence、AWS Textract、Google Document AI、
anyformat.ai、turbotable.ai、DocRouter.ai、Unsiloed、Parsli……

HN Reducto launch 帖里 jackienotchan 直接问："YC seems to fund quite many document
extraction companies, even within the same batch" 并列了 3 家同期公司。
Reducto 创始人 adit_a 自己回答："my view on the space is that this was crowded
well before LLMs."
→ 连领跑者都承认这是拥挤赛道。
https://news.ycombinator.com/item?id=44356799

### 价格已经崩到接近零
- Unstructured 托管版：$0.001–0.03 / 页
- LlamaParse：1000 credits = $1（北美）
- Reducto Scale：$1,825/月 / 150,000 页 ≈ $0.012/页
- 租约摘要（垂直应用层）：已跌到 $15/份，离岸人工 $5-25/份

单页价格趋近于零 = 商品化的定义。

### Gemini/GPT 原生读 PDF 有没有杀死专门产品？
**基本杀死了"解析"这件事，没有杀死"某垂直 schema 的可靠交付"。**
- OmniDocBench：PaddleOCR-VL 92.86 / Gemini 3.1 Pro 90.33 / GLM-OCR 94.62，
  一个 <1.3B 的开源小模型就打赢了 GPT-4o（85.80）。
- VLM 在表格、图表、手写、复选框上已全面超过传统 OCR。
- 剩余弱点：超密集版面、删除线等格式、bounding box 引用、以及"静默纠错"幻觉
  （把看到的字悄悄改成它认为应该是的字）。
- 注意：PyMuPDF 那篇《PDF-Native Beats Vision Models》是**厂商软文**，
  无任何 benchmark 数字，证据力低，别拿它安慰自己。

### 对你 9,600 行的诚实估值
- 其中"把 PDF 变成结构化文本"那部分，现在 $0.01/页 可以买到，**代码资产贬值**。
- 真正没被商品化、也是你自己已经说对的部分：
  **schema 设计 + 跨页去重 + 图↔实体匹配 + 边界检测 + eval/重试**。
  这大概是 30% 的代码，但 90% 的价值。
- 但它的变现形式**不是 API，是某个垂直的成品结果**。

### 一个更要命的结构性冲突（这条比红海更重要）
文档抽取类 SaaS **天然反自助**。抽错了要有人兜底 → 客户要 SLA、要人工复核、
要定制 schema → 天然走销售驱动、enterprise 合同。
你的约束是"自助订阅 / 极低接触 $5-20k MRR"。
**这两件事在这个品类里历史上很少同时成立。**
若坚持这个方向，必须挑：错误成本低 + schema 固定 + 买家自己会验收 的场景。

---

## 第二部分：垂直逐个评估

### 1. 房地产评估报告 / UAD 3.6（美国）— 痛感最强，但经济性差
**烂文档程度**：中。真正的痛不是文档烂，是 GSE 2026-01 强制换 UAD 3.6 格式，
旧的表单软件全废。

**从业者原话（一手，全部有 URL）**
- Billy Lumadu（IRM Solutions 评估师）："Right now, you have to mainly enter
  everything. It's tedious. I mean, *it is tedious*." 第一份报告花了 4.5-5 小时。
- Jim Stafford（Frisco, TX 独立评估师）："Every time I got frustrated, I had to
  walk away for a while"，用 app 花了平时"twice as long"。
- 评论者 M W："These are 2-3x longer, my time is now 2-3 times more expensive"
  https://www.workingre.com/rollout-of-3-6-receives-mixed-feedback/
- r/appraisal 标题即控诉（26 赞/30 评论）："I pay CoreLogic $1,000 per year
  because they have the leading software... Total will not work on launch day...
  What a joke. I'm not renewing my sub"
  https://www.reddit.com/r/appraisal/comments/1p1jj9m/
  - 帖内："Total is basically useless without quicklists and quicksource."
  - "alamode uad 3.6 is a slow awful mess... **Someone comes out with uad 3.6 at
    a low cost and it's painless? I'd switch.**" ← 这是明确的换供应商意愿
- "The 3.6 Form Is the Biggest Disruption Since the Computer"（32 赞/67 评论）
  https://www.reddit.com/r/appraisal/comments/1ozt8hb/

**谁付钱 / 多少**：评估师自己付。CoreLogic Total ≈ $1,000/年。
新玩家 Aivre 要 $50/报告。

**红海？** 表单软件层：CoreLogic(Total/alamode)、ACI、Aivre 等，在重建中。

**致命反面证据（必须看）**
- "Aivre is $50 per report? **I wouldn't even pay $25.**"
- "$50 a report? **I rather hand write my report** before doing that lol."
- "AMCs don't leave enough income for many of us to even afford all this
  additional software. I barely scrape by month to month with most bids denied."
→ 买家极度价格敏感、行业在萎缩（"a declining population of appraisers"）、
  且被 AMC 挤压利润。$5-20k MRR 需要约 200-400 个订户，在一个又穷又保守
  （"90% of appraisers are locked in their basements or don't do social media"）
  的人群里自助获客，很难。

**错误成本**：高。评估报告是 GSE 提交件，错误 → USPAP 违规、州牌照风险。不适合独立开发者兜底。

**判定**：痛是真的、原话最充分，但**买家付不起 + 错误成本高 + 窗口期短（软件商正在补齐）**。不推荐作为主攻。

---

### 2. 施工提交文件（submittals / spec book）— 痛真，但抽取环节已被吃掉
**从业者原话**：r/Construction "Submittals and why they suck"（70 赞/71 评论）
https://www.reddit.com/r/Construction/comments/vemh1z/
- 但读完全帖：抱怨的是**流程与法律责任**（CYA、paper trail、substitution
  request form），不是"我抽不出数据"。
- 建筑师方原话："it really all comes down to CYA... we never say submittals are
  'approved', only 'reviewed' or 'no exceptions taken'."
- 有人讲了 Hensel Phelps 因为管卡替换被业主起诉的故事 → 提交文件的**存在意义就是
  法律留痕**，不是效率。

**抽取环节谁在做**：Procore Submittal Builder（"scans your spec book and generates
a submittal log in seconds"）、Autodesk AutoSpecs、SubmittalLink、cloud-pm
（$40/月）。**你想做的那件事已经是巨头的免费捆绑功能。**

**判定**：红海 + 痛点错位。不做。

---

### 3. 保险 loss runs — 痛点被误判了，真问题不是解析
r/InsuranceAgent "Loss Runs for commercial p&c"（5 个月前）
https://www.reddit.com/r/InsuranceAgent/comments/1r7iqb6/
原帖："I'm working with smb so it's reasonably common for them to not readily have
a copy of their old policy number... I can then use something like Loss Run Pro,
but that takes a few days and sends the loss run directly to the customer who
needs to forward it to me... **I feel like a waiter asking a diner to make a quick
trip to the grocery store before we can cook their meal.**"

**关键洞察**：瓶颈是**拿到文件**（向承保方索取、几天延迟、客户转发），
不是拿到之后解析它。你的资产解决的是后半段，而后半段不痛。
**如果做，产品是"代理索取+追单"，那是集成与流程活，不是你的强项。**

**判定**：不匹配你的资产。

---

### 4. 商业租约摘要（lease abstraction）— 已经打完了
Kira、Leverton（JLL/MRI 背书）、Prophia、Dealpath、MRI、Lextract、DDee、
leaseabstractors.com……价格已跌到 **$15/份**（AI）/ 离岸人工 $5-25/份。
准确率宣称 90-97%。
**判定**：红海且价格已崩。不做。

---

### 5. 经销商产品目录 → PIM — 技术上最贴你的资产，但证据不足
**为什么技术上贴**：厂商 PDF 目录里"图片↔SKU 匹配"跟你已经解决的
"户型图↔户型匹配"是同一个问题；跨页去重、章节边界、一页多产品切分全对得上。

**行业数据（注意：全部来自 PIM 厂商营销内容，非一手抱怨）**
- "Getting a new manufacturer's catalog ready for distribution takes 4-8 weeks."
- "Updating a single attribute across 3,000 products takes days of manual work."
- 分销商要把 Excel / PDF / API / 印刷 spec sheet 统一成一个 schema。

**诚实标注：我没有找到任何一条从业者一手抱怨原话。** 搜到的全是 AtroPIM、
Sales Layer、Inriver、MerchKit 等厂商的软文。按你的要求，我明说：
**找不到抱怨 = 可能不痛，或者痛的人不在公开论坛发帖。**
这一条**未验证**，进入下一轮必须先做客户访谈，不能靠结构推断。

**错误成本**：低（抽错一个规格 → 改一行数据）。这是它相对其他方向的最大优势。

---

### 6. 明确劝退的方向
- **医疗（化验单、事前授权）**：HIPAA + BAA + 抽错药量/诊断码 = 患者伤害与刑责。
  独立开发者不要碰。
- **金融（K-1、报税、贷款文件）**：抽错一个数字 → 客户报税错误 → 你被索赔。
  且强季节性（K-1 集中在 3-9 月），不适合稳定 MRR。
- **法律/产权**：抽错 = 交易失败，责任无法由一人承担。
- **政府 RFP/招标**：文档确实烂，但买家是投标团队，采购周期长、要销售驱动，
  与"自助订阅"冲突。

### 加拿大特有机会（未深入验证）
- **安大略 condo status certificate 审查**：买家律师需在 2-5 个工作日内读完
  一整包（财务报表、章程、储备金研究、诉讼披露）。文件费法定上限 $100。
  https://www.condoauthorityontario.ca/resource/status-certificate/
  → 文档烂 + 时限紧 + 买家（地产律师）付得起。
  **但**：错误成本高（漏掉一项特别评估 = 律师赔偿责任），且买家是律师，
  自助订阅接受度未知。**未找到律师一手抱怨，同样未验证。**

---

## 排序与置信度

| # | 方向 | 痛点证据 | 商业可行性 | 与你资产匹配 | 总评 |
|---|------|---------|-----------|------------|------|
| 1 | 经销商目录→PIM | **低**（无一手抱怨） | 中 | **高** | 唯一值得下一轮验证的 |
| 2 | 安省 status certificate | 低（无一手抱怨） | 中 | 中 | 加拿大特色，需验证错误成本 |
| 3 | UAD 3.6 评估 | **高**（原话充分） | **低**（买家付不起） | 中 | 痛但赚不到钱 |
| 4 | 施工 submittals | 中（痛点错位） | 低 | 中 | 巨头已吃 |
| 5 | 租约摘要 | — | **极低** | 高 | 红海价格崩 |
| 6 | 保险 loss runs | 中 | 中 | **低** | 瓶颈在取件不在解析 |

**置信度**
- "横向文档抽取 API 已商品化、别做"：**高置信（0.9）**。多方独立证据：
  玩家数量、领跑者自认拥挤、价格趋零、开源小模型打赢大厂。
- "垂直层仍有空间"：**中置信（0.5）**。空间存在，但每个具体垂直我都只找到
  部分证据。
- 各垂直排序：**低-中置信（0.3-0.5）**。第 1、2 名恰恰是证据最弱的两个
  —— 这本身是个警告信号。

**最大不确定性**
1. **我没能证明任何一个垂直"既痛、又有钱、又没人做"三者同时成立。**
   证据最强的（评估）恰恰买家最穷；技术最匹配的（PIM）零一手抱怨。
2. **自助订阅与文档 AI 的结构性冲突**没有被任何证据推翻。这可能是比
   "选哪个垂直"更根本的问题。
3. Reddit 覆盖偏差：B2B 后台岗位（目录运营、PIM 管理员、理赔专员）
   基本不在 Reddit 发帖，"找不到抱怨"未必等于"不痛"，但也不能当成利好。

## 建议的下一步（不是继续搜索）
公开信息在这个问题上已经见底了。再搜只会得到更多厂商软文。
下一轮应该是 **10-15 个客户访谈**，优先级：
1. 分销商的目录/PIM 负责人（验证 #1，问"上一次导入新厂商目录花了多久"）
2. 安省地产律师（验证 #2，问"status certificate 你实际花多长时间、怕漏什么"）
不要先写代码。
