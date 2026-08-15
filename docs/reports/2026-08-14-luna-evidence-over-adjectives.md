# Luna 说空话的三个根因 —— 从一通真实电话拆到底

**日期**:2026-08-14
**事故 session**:`voice_1786660799654_8qoieo`(2026-08-13 22:40,26 句 / 392s,访客 `1c202746`)
**触发**:owner 看完对话回放

> 「烂大街的回复,我这种人都能编的出来,谁信你啊?要给 example 要列证据,
>  比如说最近就哪哪哪卖出了房子。废话减少实话增多。」

---

## 一、被点名的那句话

第 9 轮。客户问了一个**非常专业**的问题:

> **客户**:他过去几年表现比较好,但是未来的交付量也比较高。
>          那会不会影响这个区域他整体的一个未来的成交价格呢?

> **Luna**:大量的未来交付确实可能会在短期内对租金和二手房价造成一定压力……
>          不过,**朱美拉村圈作为成熟社区,凭借其高性价比和便利的位置,一直有着
>          非常强劲的本地自住和租赁需求来消化这些新增供应。**如果您担心这个影响,
>          我们可以帮您重点筛选那些品质更高、定位更稀缺的优质项目,这样在未来的
>          竞争中会更具抗跌性。

**这句话通过了当时所有的诚实性检查** —— 因为它一个数字都没编。

它只是没有内容。任何人不打开数据库都能写出来,客户当然知道。

### 更糟的是:它和数据的方向相反

同一时刻,库里的 DLD 官方登记数据(JVC 现房转售中位单价)是:

| 季度 | 中位单价 AED/㎡ | 成交笔数 |
|---|---|---|
| 2025 Q3 | 13,408 | 1,606 |
| 2025 Q4 | **14,553**(峰值) | 1,419 |
| 2026 Q1 | 14,326 | 1,126 |
| 2026 Q2 | 13,836 | 827 |
| 2026 Q3 | **12,733** | 703 |

**已经连跌三个季度,从峰值回撤 12.5%。** 期房成交量同期从 3,851 笔跌到 607 笔(-84%)。

租赁那半句也经不起查。新签租约中位租金:

| 年 | 新签租约 | 中位年租 AED | 同比 |
|---|---|---|---|
| 2022 | 20,541 | 45,000 | — |
| 2023 | 22,708 | 53,000 | +17.8% |
| 2024 | 25,418 | 62,400 | +17.7% |
| 2025 | 31,598 | 69,000 | +10.6% |
| 2026 至今 | 16,576 | 70,000 | **+1.4%** |

「非常强劲的租赁需求」在过去四年成立,**在当下正在失速**。

客户问的是「未来会不会」,数据的答案是「**已经在发生了**」。
Luna 拿一个三年期的年化涨幅,安慰了一个正在下行的市场。

---

## 二、三个根因(都不在模型)

### 根因 1:23 个工具**全是聚合**,没有一个能举证

事故发生时 Luna 的工具箱里,和市场有关的返回全长这样:

```
area_investment_report → 中位 103万 AED、近3年年化 10.9%、毛收益 5.93%、流动性 high
compare_market         → 期房 15,069/㎡(41,787笔);现房 13,761/㎡(22,659笔)
```

**没有一条是「某月某日某楼盘某户型以某价成交」。**

聚合标量答不了「你凭什么这么说」。模型手上只有形容词可用,于是就用了形容词。
第 16 轮它甚至自己说漏了嘴 —— 「您是想看看这里最近大约一百九十万迪拉姆左右的
**真实成交案例**」—— 它知道该给案例,但**没有工具能拿到**,只好反问客户要不要看。

> **禁编数字 ≠ 禁编结论。** 旧规则只堵住了前者,模型就学会了走后者:
> 不说数字就永远不会被抓,于是满篇「强劲/稳步/可观/抗跌」。

### 根因 2:标量藏住了拐点

「近3年年化 +10.9%」和「已经连跌三季」**可以同时为真**。
客户问的永远是后者,而工具只提供前者。

### 根因 3:区名没翻译 —— 把同一个区当两个区推荐

第 13 轮:

> **客户**:不是,我是说你说的抗跌性,哪些区域会更具有抗跌性?
> **Luna**:例如,**阿尔希比亚一区**……保值属性很强;而**阿尔巴沙南四区**……
>          拥有近三万笔的庞大交易量,流动性极高。

DLD 地籍名和客户嘴里的名字是两套词汇表:

| DLD 地籍名 | 客户认识的名字 |
|---|---|
| `Al Barsha South Fourth` | **JVC**(朱美拉村圈) |
| `Al Hebiah First` | **Motor City**(摩托城) |
| `Al Khairan First` | **Dubai Creek Harbour**(云溪港) |
| `Al Barshaa South Third` | **Arjan** |

**「阿尔巴沙南四区」就是客户刚聊完的 JVC 本身**,换了个阿拉伯地籍名,
被当成「另一个更抗跌的区」推荐了回去。同句里的「阿尔希比亚一区」
其实是迪拜人人都知道的 **Motor City**。

客户完全看不出来。这不是模型幻觉,是**工具层漏了一次翻译**。

---

## 三、从专业经纪话术里学到的(网上找的方法论)

| 方法 | 出处要点 | 落到 Luna 的哪一条 |
|---|---|---|
| **双面论证 two-sided persuasion** | 先摆反面再回应,比单面吹更能建立持久信任;单面陈述会触发「他在藏什么」的怀疑 | 新增 prompt 段「TELL THEM THE BAD NEWS FIRST」 |
| **战略性示弱** | 主动承认不利面,建立信任比装完美快得多 | 数据不利时**先说**,不许塞进转折从句 |
| **comps 规范** | 3-5 套、近 3-6 个月、同社区同户型,并解释差异 | `recent_transactions` 默认近 6 个月、同区同户型、返回 6 笔 |
| **拒绝 vague market rhetoric** | 具体成交地址是专业和业余的分界线 | 「禁用空形容词」规则 + 举证工具 |

一句话:**主动交出那个不利的数字,是让你其余数字被相信的最强信号。**
只听得到好消息的客户会正确地推断你在隐瞒。

---

## 四、改了什么

### 1. 两个新工具(给它可举证的原子事实)

**`recent_transactions`** — 逐笔真实成交
```
GET /api/ai/analytics/recent-transactions?area=JVC&bedrooms=1&segment=ready&limit=6
→ 8月13日 Luma Park Views 1房 82㎡ 125万(15,244/㎡·现房)
  8月13日 Rise Residences   1房 69㎡  88万(12,689/㎡·现房)
```
按 (日期,项目,面积,价格) 去重 —— DLD 原始数据里同一套房有完全重复的行。

**`price_trend`** — 逐季度中位单价 + 量,**峰值/回撤/连跌季数在服务端算死**
```
GET /api/ai/analytics/price-trend?area=JVC&segment=ready
→ drawdown_from_peak_pct: -12.5
  consecutive_falling_quarters: 3
  direction: "falling"
```
「自己从序列里找峰值」正是模型最容易算错、也最容易含糊过去的一步,所以不留给它。

### 2. 区名翻译 + **两道置信度门槛**

`/compare?vary=area_name` 现在把地籍名翻成客户认识的名字,并标 `same_as_query`
(告诉模型「这条就是他刚问的那个区,别当新选项」)。

但 `dld_areas → dubai_areas` 这张桥接表是模糊匹配建的,**有兜底垃圾桶**:

- `Deira` 一个名下挂了 **35 个**地籍区,混着 `Al Barshaa South Second`
  (7,727 笔成交,实际在 Arjan 旁边)和 `Al Yelayiss 3/4`(Dubai South 方向)
- `Palm Jumeirah` 名下混进了 `Al-Muhaisnah North`(**内陆区,离棕榈岛半个迪拜**)

> 🔴 **无条件翻译 = 拿一个更隐蔽的错去修一个明显的错。**
> 不翻译时客户听到「阿尔巴沙南二区」只是拗口;硬翻之后他听到「Deira」——
> 一个**听起来完全合理、实际指鹿为马**的答案。后者危险得多。

所以加了两道门槛,**翻不动就原样保留**:

1. **siblings ≤ 4** —— 同一营销名底下挂了几个地籍区。抽查成交量 top 45,
   所有正确映射都 ≤4,唯一一条错的正好是 siblings=35 的垃圾桶。
2. **没有更贴近的兄弟** —— `Palm Jumeirah` 只挂 2 个,siblings 门槛拦不住;
   但它名下有个词重叠 1.0 的真身 `Palm Jumeirah`,而 `Al-Muhaisnah North` 是 0
   → 只认前者。而 `JVC ← Al Barsha South Fourth` 重叠也是 0 却正确 ——
   区别在于**它没有竞争者**。判据是「有没有比我更像的兄弟」,不是「我像不像」。
   (阿拉伯语转写拼法不统一 `Muhaisanah`/`Muhaisnnah`,所以前 5 字母相同算半分。)

**门槛跑分 22/22。**

### 3. Brain 提示词:证据规则 + 双面论证

- **EVIDENCE** — 「关于市场的判断,要么挂着工具给的事实,要么不说」;
  空形容词黑名单;把事故原句当反例写进去
- **TELL THEM THE BAD NEWS FIRST** — 数据不利时先说、给数字,不许软化成从句
- **SPEED 段修正** — 明写「举证工具和主工具**放同一批并行调**,不额外花时间」,
  否则新规则会被旧的「别多调工具」压制

### 4. `stripMarkup()` —— 朗读稿里的 markdown 由代码剥,不靠提示词

提示词从第一版就写着 "No markdown",让它列举三个区做对比时照样加粗区名
(`**迪拜码头 (Dubai Marina)**`)。speech 是**逐字朗读**的最终稿,星号会被念出来。
**这类不变量属于代码:提示词负责说什么,代码负责保证能念。**

---

## 五、效果对比(同一个问题,同一套数据)

**❌ 修复前**
> 大量的未来交付确实可能会在短期内对租金和二手房价造成一定压力……不过,朱美拉村圈
> 作为成熟社区,凭借其高性价比和便利的位置,一直有着非常强劲的本地自住和租赁需求
> 来消化这些新增供应。

**✅ 修复后**(`price_trend` + `recent_transactions` 并行)
> 其实这种影响不只是未来的风险,**而是已经在发生了**。根据迪拜土地局的登记数据,
> JVC 的二手现房中位单价在去年第四季度达到每平方米一万四千五百五十三迪拉姆的峰值,
> 之后**已经连续三个季度下滑**,目前跌到了每平方米一万二千七百三十三迪拉姆,
> 跌幅大约有百分之十二点五。
>
> 不过,不同品质的项目分化很严重。比如就在**八月十三号,Luma Park Views 的一套
> 一居室现房以一百二十五万迪拉姆成交,而同一天 Rise Residences 的一居室成交价
> 则是八十万迪拉姆**。您目前关注的是哪个具体的项目或开发商?

英文场景同样(`creek-harbour`):
> **To be direct**, ready resale prices in Dubai Creek Harbour are experiencing a
> correction… peaked at 26,021 per sqm, has since slipped over six percent, two
> consecutive quarters of declines down to 24,271. **To show you what this looks like
> on the ground**, a two-bedroom at Creek Beach Rosewater sold on August 13th for
> 2.3 million, and a three-bedroom at Palace Residences North closed August 12th for 4.15 million.

---

## 六、跑分

| 跑分 | 结果 |
|---|---|
| Tier1 工具层 `luna-eval.ts` | **85/85** |
| Tier1.5 大脑层 `luna-brain-eval.ts` | **9/9** |
| 事故复现 `luna-evidence-repro.ts`(**新增**) | **4/4** |
| 区名翻译门槛 | **22/22** |

新增跑分脚本 `backend/scripts/luna-evidence-repro.ts` —— 把这次事故的四个提问
原样固化,断言「调了举证工具 / 有数字 / 点名了项目 / 没回避下行 / 没 markdown」。

```bash
cd backend && LUNA_TOOLS_API_BASE=https://api.pinzos.com \
  npx ts-node -T scripts/luna-evidence-repro.ts
```

⚠️ 写这个脚本时自己踩了一次:第一版正则只认阿拉伯数字,
把一条满是证据的**英文**回答判成「一个数字都没有」——
提示词明令「像人一样念金额」,英文里数字本来就该拼成词(`two point three million`)。
**假红灯比漏报更伤。**

---

## 七、遗留

1. **GHCR token 失效** —— `$GITHUB_TOKEN`(classic PAT)已 401,`gh` keyring 里那个
   是 `gho_` OAuth token,**GHCR 不接受**。本次部署绕道
   `docker save | ssh 'docker load'`。要恢复 `quick-deploy.ps1`,需要重新签发一个带
   `write:packages` 的 **classic PAT**。
2. **桥接表 `dld_areas.dubai_area_id` 本身有错**,只是被门槛挡住了,没有修数据:
   `Al Barshaa South Second`/`Al Yelayiss 3/4` → Deira、`Al-Muhaisnah North` → Palm Jumeirah。
   另有 `Al Yelayiss 1`(**10,717 笔成交**,应是 Dubai South/Emaar South 一带)和
   `Al Yelayiss 2`(5,010 笔,应是 Town Square)**完全没桥接**,这两个区目前只能显示地籍名。
3. 事故第 17 轮有一处**重播文本损坏**:第 16 轮「两百八十三万」在重播时变成
   「两百**万**八十三万」。本次未查(属于 Live 层重播路径,不在 Brain)。

---

相关记忆:[[luna-two-layer-architecture]] · [[luna-eval-harness]] · [[luna-data-boundaries]]
· [[dld-transaction-group-trap]] · [[dubai-areas-i18n]]
