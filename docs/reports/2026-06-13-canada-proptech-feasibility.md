# 加拿大房产市场调研：迪拜 proptech 系统能否搬到加拿大

调研日期：2026-06-13。系统画像 = AI 沉浸式房产导览 + 客户行为追踪/lead + 基于官方成交数据的投资分析 + 中文/多语,原本主打迪拜的期房和海外买家。
所有数字带年份+来源 URL,拿不到的数据明确标注 GAP,不编。

---

## 1. 外国买家禁令(最关键)

**结论:禁令真实有效,延到 2027-01-01,且覆盖面广——但实际影响窄,因为外国买家本来就只占成交的 ~3–5%,且有大量豁免。"服务海外买家"这条假设基本失效。**

- 《Prohibition on the Purchase of Residential Property by Non-Canadians Act》2023-01-01 生效,原为 2 年期。(2023) https://laws-lois.justice.gc.ca/eng/acts/P-25.2/page-1.html
- **2024-02-04 联邦政府宣布延长两年至 2027-01-01**,2026 全年仍完全有效。(2024) https://www.cicnews.com/2024/02/canada-extends-foreign-home-buyer-ban-until-2027-0242824.html ; https://www.airdberlis.com/insights/publications/publication/federal-government-extends-prohibition-on-purchase-of-residential-property-by-non-canadians-to-january-1-2027

**豁免人群(2024–2025):**
- **永久居民(PR)、Indian Act 注册者**——从不在禁令范围内。
- **工签持有者**:购房时工签剩余有效期 ≥183 天,且名下不超过 1 套住宅(2023-03-27 修订后放宽)。
- **国际学生**:极严——在 DLI 注册 + 前 5 年每年报税 + 每年实际停留 ≥244 天 × 5 年 + 房价 ≤ CAD $500,000;被普遍认为"几乎没人符合"。https://houseindex.ca/blog/canada-foreign-buyer-ban-complete-guide
- **难民/受保护人**;**符合条件买家的非加籍配偶**;外交人员。
来源:CMHC https://www.cmhc-schl.gc.ca/professionals/housing-markets-data-and-research/housing-research/consultations/prohibition-purchase-residential-property-non-canadians-act

**豁免房产类型(非加拿大人可以买):**
- **4 套及以上单元的建筑**(禁令只覆盖 ≤3 单元)。
- **CMA/CA(人口普查都会区/集聚区)以外的住宅**——农村/小镇不禁。
- 住宅/混合用途**空地**(2023-03-27 修订豁免);Section 35 原住民土地。
来源:CMHC(同上)

**"非加拿大人"含外国控股公司**:不是加籍/PR/Indian Act 注册者的个人;受非加拿大人控制(**10% 股权或投票权**门槛,2023-03-27 由 3% 上调)的私有公司,以及外国实体。加拿大交易所上市的公众公司豁免。https://gazette.gc.ca/rp-pr/p2/2023/2023-04-12/html/sor-dors66-eng.html

**罚则**:违规非加拿大人最高罚 **CAD $10,000**;**同样的罚则适用于"明知而协助"者(经纪、律师、平台都可能中招)**;法院可下令司法拍卖,但购买本身不因此无效。**这是平台/经纪服务海外买家的核心法律风险点,任何"协助/顾问"功能须法律审查。**

**实际市场影响(关键)**:外国买家历来占比很小。
- 2016–17 峰值,外国买家约占大温哥华成交 **~5%**,主要城市约 **3–5%**。https://www.cbc.ca/news/business/canada-foreign-buyers-ban-jan-1-experts-1.6692706
- BC 征外国买家税后,外国买家交易从 ~3%(2017)降到 ~1.1%(2021)。
- StatCan(2020 数据):非居民住宅持有比例 **安省 2.2%、BC 3.1%**;但**公寓更高**——安省 6.5%(2016 后新盘 9.2%)、BC 8.4%(2016 后新盘 13.4%)。https://www150.statcan.gc.ca/n1/daily-quotidien/201028/dq201028a-eng.htm
- 注意定义差异:StatCan "非居民" ≠ 该法 "非加拿大人",数字不能混用。

**2027 后走向 — GAP**:**找不到任何官方对 2027 后的明确表态。** 已延长过一次(先例)、公众支持率约 75%、行业评论倾向"定向改革"(如澳洲式只许买新建)而非彻底废除——但都是评论非政策。建议:**别假设 2027-01-01 禁令自动失效。**

---

## 2. 成交数据可得性(关键)

**结论:加拿大成交价数据 NOT 像迪拜 DLD 那样免费开放。由私营行业协会(boards)控制并需登录。"投资分析/价格体检"可行,但要先成为持牌 brokerage / VOW 合作方,接受展示限制,运营和法律成本远高于迪拜。**

- **CREA** 运营 Realtor.ca,公开免费的只是**聚合统计**(地区均价/基准价、MLS HPI),**不是带地址的逐笔成交价**。https://www.crea.ca/housing-market-stats/canadian-housing-market-stats/
- **逐笔成交数据由地方 boards 拥有控制**:TRREB(多伦多,前 TREB)、REBGV(大温)。被当作专有数据。
- **迪拜对比**:DLD 在 Dubai Pulse 免费发布**每一笔交易**(价格/面积/物件),CSV + 开放 API。加拿大全国无对等物。https://www.dubaipulse.gov.ae/data/dld-transactions/dld_transactions-open

**HouseSigma/Wahi/Zealty/Zolo 如何拿/展示成交数据**:
- Feed 分层:**IDX**=仅在售;**DDF®(CREA)**=全国在售公开列表,**不含成交**;**VOW(Virtual Office Website)**=**唯一含成交+历史数据的 feed**,但**需用户注册 + 真实经纪-消费者关系**。https://realtywebsites.ca/what-is-the-difference-between-idx-vow-and-ddf/
- **HouseSigma**:TRREB 注册的 VOW 合作方,看 sold 价**必须邮箱注册**,触发"bona fide consumer"问卷并匹配旗下经纪。https://housesigma.com/blog-en/faq/looking-for-properties/why-you-have-my-home-price-on-the-website/
- **Wahi**:数据来自 ITSO + TRREB,**需免费注册**才看成交价。
- **Zealty(BC)**:20+ 年 BC MLS 历史 + AI 估值,**明确要求登录**;未披露确切数据源(GAP)。
- **Zolo**:免费 MLS 搜索,正在 GTA 推 sold 价+历史。
- **统一规律**:每个展示逐笔成交价的消费端站点都靠 board VOW 协议 + 登录闸门,没有真正开放/可下载/免登录的逐笔数据。

**TREB 数据案**:
- 2012 竞争局起诉 TREB 滥用支配地位 → 2014 联邦上诉法院支持竞争局 → 2017-12 FCA 重申 TREB 限制"阻碍创新竞争" → **2018-08-23 加拿大最高法院拒绝受理上诉,判决终局**。https://www.canada.ca/en/competition-bureau/news/2018/08/supreme-court-will-not-hear-toronto-real-estate-boards-appeal.html
- **确立**:TREB 会员/VOW 运营方可通过 VOW 向消费者展示历史成交价。**没确立**:数据并未变成公开开放——访问仍只走 board feed + 经纪会员 + 消费者登录(所以 HouseSigma 至今仍要注册)。

**政府开放数据 — 有限**:
- **BC 物业转让税开放数据**:免费,但**聚合**(按市/区),**无逐笔、无地址**,<5 笔的区被屏蔽。https://open.canada.ca/data/en/dataset/c0aa52e1-ee9c-467e-b20b-89207bcbcf07
- **BC Assessment / LTSA**:有估值/产权,但明细查询走 myLTSA / BC Assessment,**多为按次付费**。
- **安省 Teranet**:土地登记由私营 Teranet 运营,转让记录经 GeoWarehouse / OnLand **按次付费**,不免费、不能批量下载。https://www.teranet.ca/industries/public-land-and-title-records/
- **GAP**:没找到任何加拿大省/联邦提供**免费、批量、带地址逐笔成交价**的对等于 Dubai Pulse 的源。

**可行路径**:照搬 HouseSigma/Wahi——成为目标 board 的 VOW 会员,成交价放在免费账号后面,公开/匿名页只放聚合免费数据(CREA HPI、BC PTT)。VOW 许可费 / brokerage 注册成本未量化(GAP,需成本测算)。

---

## 3. 期房/预售市场

**结论:"买家买渲染图"前提在加拿大成立,沉浸导览是真实存在的品类,但 2024–2025 GTA/温哥华新盘市场崩盘,瓶颈是需求塌方和项目融资断裂,不是看房可视化。沉浸导览的卖点更可能是"省钱替代实体售楼处"而非"拉需求"。**

GTHA 新公寓销量崩盘(Urbanation):
- 2023:12,696 套(当时 15 年低)。2024:**仅 4,590 套,1996 年以来最低,同比 -64%**,比 10 年均值(20,835)低 78%。https://www.urbanation.ca/news/gtha-new-condo-sales-2024-were-lowest-1996
- **2025 Q3:仅 319 套,35 年来最低(1990 Q3 以来)**;全年 ~1,599 套(1991 年以来最低,GAP:全年数二手源)。https://www.urbanation.ca/news/condo-project-cancellations-hit-record-high-q3-sales-fall-35-year-low
- 未售库存 2024 末创纪录 24,277 套;CMHC:多伦多期房 2025 Q1 库存达 **57.4 个月**(2022 Q1 仅 1.9 个月)。https://www.cmhc-schl.gc.ca/observer/2025/condominium-apartment-market-risks-toronto-vancouver
- 大温:2024 预售 launch 同比 -21.7%,仅 5,083 套;2025 预售成交 5,822 笔 vs 10 年均值 15,123。https://mlacanada.com/newsfeed/mla-intel-2026-understanding-the-current-real-estate-landscape

期房 vs 二手占比 — **GAP**:找不到干净权威的"期房占总成交 X%"全国比例。可用代理指标:大温多伦多新建公寓 **58.7% 为投资者持有**,期房历来由投资者主导。https://betterdwelling.com/toronto-condo-sales-are-unusually-weak-investors-capture-a-larger-share/

监管/冷静期:
- **BC(REDMA,BCFSA 监管)**:开盘前须备案 disclosure statement;**7 天 rescission(无理由撤销)**,退款 15 天内。
- **安省(Condominium Act s.73)**:新建公寓直接向开发商买有 **10 天冷静期(日历日,无理由,退全款+利息)**;**不适用**二手/assignment/MLS。https://www.condoauthorityontario.ca/before-you-buy-or-rent-a-condo/buying-a-condo/pre-construction-condos/

沉浸导览需求:CondoNow 聚合 450+ 项目并给经纪 "brochures, virtual tours, renderings";加拿大有专门 VR/渲染工作室(RenderLand 等)。但 31%/68%/92% 这类转化数据来自厂商博客,**仅作方向性证据,未独立验证**。

2025–2026 状态 = **深度危机**:GTHA 自 2024 初取消/搁置/接管 28–32 个项目(~7,000 单元);CMHC 称 2024 取消量多伦多 5 倍、温哥华 10 倍于 2022;2025 Q1 ~55% 期房未售,低于贷款方要求的 ~70% 预售线导致无法开工;投资者负现金流、最高 6% 资本亏损;assignment 市场冻结。https://www.cmhc-schl.gc.ca/observer/2025/condominium-apartment-market-risks-toronto-vancouver

---

## 4. 市场规模与生态

| 指标 | 数值 | 年份 | 来源 |
|---|---|---|---|
| 全国成交量 | 443,511 套(2008 以来最低) | 2023 | CREA via CBC |
| 全国成交量 | 470,314 套(-1.9%) | 2025 | Investment Executive/CREA |
| 全国成交量(预测) | 494,512 套(+5.1%) | 2026 | 同上 |
| 全国均价(12月) | $673,335 | 2025 | 同上 |
| 多伦多均价 | $1,006,735(-5.1% YoY) | 2025-12 | TRREB |
| 大温基准价 | $1,114,800(-4.5% YoY) | 2025-12 | GVR |

来源:https://www.investmentexecutive.com/news/research-and-markets/national-home-sales-fell-nearly-2-in-2025-but-growth-expected-this-year-crea/ ; https://trreb.ca/market-data/market-watch/
**GAP**:CREA 不发布"全市场总成交额";粗算 470,314 × ~$680K ≈ **~$3,200 亿 CAD/年**(本人估算,非来源数据)。

持牌经纪人数:
- **CREA 全国会员 >160,000**(2025,比题目的 ~150k 已上修)。https://www.globenewswire.com/news-release/2025/04/08/3058040/0/en/The-Canadian-Real-Estate-Association-Installs-2025-2026-Board-of-Directors.html
- **安省 RECO 注册者 >110,000**(2024)。
- **BC(BCFSA)持牌 29,441**(2023-12-31;含全部地产类别)。https://www.bcfsa.ca/about-us/news/blog/licensing-and-enforcement-statistics-2023

佣金结构:
- 加拿大典型总佣金 **4–5%**(安省常见 5%),买卖双方经纪**各 ~2.5%**,**传统上卖家付双边**。https://www.nesto.ca/real-estate/understanding-real-estate-commissions-in-canada/
- **迪拜对比**:标准 2%,**由买家付**(二手市场卖家通常不付)+ 5% VAT。
- 关键差异:加拿大"卖家付双边 ~5%"约为迪拜 2% 的 **2.5 倍**,且付费方相反。

佣金集体诉讼(类似美国 NAR):
- Sunderland & McFall 集体诉讼,指控 MLS 要求挂牌经纪给买方经纪报酬属反竞争合谋(竞争法 s.45);2024 初由 TRREB 扩至全国 ~72 boards + CREA + 10 加盟品牌 + 8 brokerage。https://www.bnnbloomberg.ca/business/real-estate/2024/02/07/real-estate-commission-lawsuit-expands-across-canada/
- **2025-10-08 联邦法院批准 RE/MAX Canada 和解 ~$7.8M CAD**——**首例**,但不了结对 CREA/boards 等的诉讼,仍在进行。https://realestatemagazine.ca/re-max-canadas-7-8m-settlement-a-turning-point-for-canadian-real-estate/
- **竞争局**:2024-10 推进对 CREA 佣金规则调查,2025-05 扩至魁省 QPAREB/Centris。
- **美国 NAR 和解**($418M,2024-03-15;实务变更 2024-08-17 解绑买方佣金)对加拿大**直接法律影响小,间接影响显著**——平行推动加拿大同类变革。

proptech 环境:加拿大 proptech 市场 ~US$2.5B(2024)→预测 2035 US$13.1B(CAGR 16.2%,厂商估算,方法不透明);530+ 创业公司;2024–2025 融资 $1.5B+ 反弹,AI 为重点。https://www.proptechcollective.com/report

---

## 5. 华人/移民买家

**结论:这是比"海外买家"扎实得多的切入点。本地华人 PR/citizen 不受外国买家禁令限制,占比大、语言独特、已被验证愿意消费中文房产服务——但已有本地竞品(房大师/RealMaster、51.ca、微信经纪网络)。**

人口规模(2021 普查):
- 全国华人 **170 万,占 4.7%**;其中 **28.4% 在加拿大出生**(天生公民)。https://www150.statcan.gc.ca/n1/daily-quotidien/260213/dq260213a-eng.htm
- **列治文 BC**:华人裔 ~99,780 = **47.9%**,华语为第一母语 44.5%。**本拿比 BC**:华人裔 30.0%。
- **万锦 ON**:华人裔 ~146,145 = **43.3%**(第一大族裔)。**列治文山 ON**:28.5%。
来源:StatCan Focus on Geography Series(各市页)
- 普通话 = 第一大非官方母语(67.9 万),粤语第三(55.3 万)。https://environicsanalytics.com/resources/blogs/ea-blog/2022/08/17/census-2021-canadas-linguistic-diversity

不受禁令限制:禁令针对身份非族裔,**PR/公民任何背景都能自由买**。中国来的新 PR:2023 = 31,765(第 2 大来源国),2024 = 19,055。
- **GAP**:StatCan 不按族裔统计购房,"华人购房以本地 PR/公民为主"是基于豁免规则+人口结构的合理推断,非直接测量数据。

中文房产服务需求已被验证(同时也是竞争):
- **RealtorAccess**:覆盖大温 230,000+ 微信用户的普通话营销平台。
- **51.ca**:多伦多/温哥华/卡尔加里中文房产 App。
- 个体经纪靠微信建大客户群(已成主渠道)。

为什么本地华人 > 海外买家:外国买家 2024 仅 ~1% 市场(峰值也才 3–5%),"95%+ 是本地买家",且禁令冻结至少到 2027;而每年 ~45 万移民入境后即可买房。https://www.mpamag.com/ca/mortgage-industry/industry-trends/is-it-time-for-canadas-foreign-homebuyer-ban-to-go/549246

---

## 6. proptech 竞争格局

- **Realtor.ca(CREA)**:官方门户,**>60% 在线市场份额**,2025 年 6.33 亿访问。强:权威全面免费;弱:**不主打成交价/AI 估值**(正是别家切入点),保守慢。https://www.crea.ca/cafe/realtor-ca-highlights-for-2025-a-look-at-the-numbers/
- **HouseSigma**:2017 成立,**>200 万月活**,Trustpilot 4.9,**主打可见成交价 + AI 估值**;Tracxn 称**零融资(自举)**;靠**经纪 lead-gen** 变现。弱:主要覆盖安省/BC,AI 估值精度不稳。
- **Wahi**:2021 上线,CEO Benjy Katchen(**银行背景,非题目所说"前 Zillow 高管"——该说法存疑/疑误**);"true price" + 佣金返还 brokerage;**2024 在增长**(月均新单 +200%,2024-07 进军 Alberta),非"挣扎";~$15M 年收(第三方估算)。
- **Houseful(前 OJO Canada,RBC 拥有)**:2023-02 RBC 收购,2023-10 改名;2025 HousingWire Tech100;强:RBC 资金+房贷交叉销售。
- **Properly**:iBuyer,2022-11 裁员 71 人,**2023-10 被 Pine 收购**(非清算)。**加拿大纯 iBuying 已失败退出——别做。**
- **Zolo**:号称最大独立 marketplace,~800 万房源库,自营 brokerage,经纪会 20+ 语言;靠佣金+广告。
- **Zoocasa**:**2022-07 被 eXp 收购(不是 RBC,题目把它和 Houseful 搞混了)**,已扩张到美国 50+ 城。

**关键空白(谁在做 AI 导览/中文/presale)**:
- **AI 沉浸导览**:加拿大**无本土平台**;品类被外国 Matterport(美)、Giraffe360(英,$10M B 轮)占据,卖的是通用 3D 扫描,**不结合本地成交数据+AI 讲解**。→ **空白机会**。
- **中文平台**:已被本地占据——**房大师/RealMaster** 自称"加拿大最大华人房产平台",20+ 年成交历史、智能估价、暗盘/楼花转让;还有加国易居(带 VR)、加房网;**居外/Juwai 是面向中国境内买家(海外买家),不是本地华人**。→ 本地华人段有竞品,但**这些 App UX 老旧、缺现代 AI**,可被 AI-native 体验弯道超车。
- **presale 营销平台**:Livabl(前 BuzzBuzzHome,Zonda 拥有)、Precondo、CondoNow、PresaleHomes——多为外资/已有;**开发商侧 AI 营销工具(AI 渲染未建单元导览、AI lead 资格筛选、中文 presale)较薄**。
- **给经纪的 AI lead-gen**:无明确加拿大本土领头羊,**开放领域**。

可赢空白:① **AI-native 中文平台服务本地华人买家**(成交数据+AI ROI+中文 AI 语音/导览);② **加拿大 AI 沉浸导览**(3D + AI 语音向导 + 成交对比/ROI 叠加);③ **AI 投资/ROI 分析作为切入楔子**(Realtor.ca 没有,HouseSigma 估值"不稳");④ 开发商侧 AI presale 营销。**避免**:纯 iBuyer、通用英文房源门户。

---

## 7. 开发商/builder presale 营销

**结论:开发商靠分层经纪网络卖楼(不靠大众广告),已有"开发商付费曝光"先例但弱于迪拜;presale 佣金由开发商付,GTA 3–7%、BC 阶梯式;2024–2025 崩盘使开发商极度焦虑、狂撒买家激励——但崩盘时营销预算最先砍,且接盘方可能是接管人/贷款方而非开发商。**

营销模式(GTA 五阶漏斗):Friends&Family → **Platinum 经纪(~10 个,卖掉项目 30–50%)** → VIP 经纪(100–200 个)→ 全体经纪 → 公开开盘(此时已售 >50%)。开发商需预售 **70–85%** 才拿到建设融资,所以靠经纪前置去化。https://www.gta-homes.com/platinum-access-vip-condos/
大温用专门项目营销公司:**Rennie、MLA Canada** 提供端到端营销+买家分析。

开发商付费曝光/lead-gen 模型(对比迪拜):
- **BuzzBuzzHome/Livabl**:对消费者免费,**核心商业模式是卖开发商首页置顶/精选位**(月费)。https://en.wikipedia.org/wiki/BuzzBuzzHome
- **CondoNow** 卖 "Developer Advertising";**CondoDomain**(2005)本就是"给豪华高层开发商做 lead generation"的历史先例。
- **迪拜对比**:Property Finder/Bayut 是显式 pay-for-leads/置顶,按 lead 量/ROI 直接卖(某项目月花 AED 60,000 ≈120 leads)。
- **GAP**:**加拿大没有迪拜式成熟透明的"按 lead 付费、可测 ROI"门户**;加拿大多为精选位/广告费或 brokerage 佣金。Dubai 式产品在加拿大是"市场教育型"销售,非照搬。

presale 佣金:
- **GTA**:典型 **3–4%**,部分项目高至 **7%**,**开发商付,买家不付**。https://www.gta-homes.com/real-estate-info/most-frequently-asked-questions/
- **大温**:阶梯式 ≈ **首 $100,000 收 2% + 余额 ~1.1%**,开发商付;~50% 在签约 60 天内付,余款完工时付,deal 崩有 clawback。https://www.strawhomes.com/how-does-a-realtor-get-paid-new-construction-presales-bc/
- ~70% presale 买家是投资者;assignment(完工前转让购买合同)是 VIP 投资者套现方式,但贷款方不喜欢出资 assignment。

2024–2025 崩盘=开发商焦虑(产品时机的最强信号):
- GTHA 2025 Q1 仅 533 套(同比 -62%,低于 10 年均值 88%);2025-12 全 GTA 仅卖 87 套新 presale;未售库存 23,918 套 = **78 个月供应**(纪录)。https://www.urbanation.ca/news/slowest-condo-market-over-30-years-causing-construction-collapse
- 开发商买家激励:closing 返现 $5k–$25k、免升级、车位/储物间减免 $20k+、**租金保证最高购价 6% 持续 24 个月**,甚至送 Aeroplan 积分。https://bridge.broker/real-estate-investment/new-home-incentives-ontario/
- **温哥华 Rennie 2025 裁 31 人,主要砍 presale 营销团队**;被两个进入接管的 Thind 项目换掉销售代理。https://dailyhive.com/vancouver/rennie-the-agency-real-estate-brokerage-partnership

风险(对论点不利):① 加拿大无迪拜式透明 CPL 市场;② 崩盘时营销预算最先砍,接管项目可能零营销预算,买方变成接管人/贷款方;③ 销售经 ~10 个 platinum 经纪把关,产品可能得卖给/通过 brokerage 而非直接对开发商。

---

## 加拿大 vs 迪拜 关键差异速查表

| 维度 | 迪拜 | 加拿大 | 对系统影响 |
|---|---|---|---|
| **外国买家政策** | 欢迎,海外买家是核心客群 | **禁令至 2027-01-01**,违规含协助方罚 $10k;外国买家仅占 ~1–5% | "服务海外买家"**核心假设失效** |
| **成交数据可得性** | DLD 免费开放,CSV+API,逐笔 | **不开放**,board 控制,需 VOW+brokerage+登录,政府逐笔数据按次付费 | 投资分析功能**可做但门槛高得多** |
| **期房占比/状态** | 期房为主、活跃 | "买渲染图"成立但 **2024–25 新盘崩盘**(GTA 销量 -95% vs 2021),项目大量取消 | 沉浸导览**需求真,但时机差**;卖点转向"省钱替代售楼处" |
| **佣金** | 2%,买家付 | **4–5%,卖家付双边**(迪拜的 2.5 倍);presale GTA 3–7% 开发商付;集体诉讼+竞争局在攻击 | 佣金透明/解绑是 proptech 楔子 |
| **华人买家** | 海外中国买家 | **本地华人 PR/公民**(列治文 48%、万锦 43%),不受禁令,~95% 本地买家;已有竞品 | **比海外买家扎实得多**,但非空地 |

---

## 一句话总结

**失效的核心假设**:① "主打海外买家"——加拿大禁令直接掐死(且协助方有法律责任);② "基于免费开放官方数据做投资分析"——加拿大没有 DLD,数据被 board 锁在 VOW+登录后面,要先做持牌 brokerage;③ "卖给开发商按 lead 付费"——加拿大无成熟 CPL 门户,且崩盘期营销预算最先砍。

**反而更强的假设**:① **中文/多语**——本地华人 PR/公民是 ~95% 本地买家里语言独特、规模大(170 万,目标市 30–48%)、已验证愿付费的硬核客群,且**不受禁令限制**;② **AI 沉浸导览 + AI 投资 ROI 分析**——加拿大**无本土 AI-native 中文平台**,现有中文 App(房大师)UX 老旧缺 AI,沉浸导览品类被外国通用扫描占据,留有可弯道超车的空白;③ 把目标客群从"海外买家"换成"本地华人买家",把数据策略从"开放数据"换成"VOW 合作 brokerage",这套系统在加拿大依然成立——只是要换骨不换皮。

---

## 诚实标注的数据缺口(GAP)

1. **2027 后禁令走向无任何官方表态**——最强发现是"无信号"+延长先例,别假设自动失效。
2. **没有族裔标注的购房交易数据**——"华人购房本地驱动"是推断非测量。
3. **期房 vs 二手成交占比**无干净全国数据。
4. **全市场总成交额**($3,200 亿)为本人估算,非来源。
5. **VOW 许可费/brokerage 注册成本**未量化,需成本测算。
6. **VR 转化率 31%/68%/92%** 来自厂商博客,仅方向性。
7. **Wahi"前 Zillow 高管"说法存疑(疑误)**;**Zoocasa 属 eXp 非 RBC**(题目混淆);**HouseSigma 零融资/Wahi $15M 收入**均单一第三方估算。
8. 多个 board VOW 费率、加拿大门户 rate card 不公开。
