# 实时带看人声选型:Agora vs LiveKit(纯语音)

日期:2026-06-20 · 背景:只需经纪↔客户双向语音,担心 Agora 成本 + LiveKit 是否只做 AI

## TL;DR
**建议保持 Agora**(已集成完成)。用户的两个顾虑是误读:
- "$350/月 + 50 并发" 是 **Agora Chat(IM)** 产品,**不是语音**。
- Agora **语音 = 纯按量、无订阅**:$0.99/1000 分钟,**每月免费 10,000 分钟**,无 50 并发硬限。
- LiveKit 纯语音也行(内核是通用 WebRTC SFU,AI 只是营销),但 **Cloud 无中国大陆节点/ICP**。

真正分水岭:**是否有中国大陆客户**。有 → Agora(跨境质量它独一份);完全没有 → 两家都行。

## 价格对比(demo 规模)
| | Agora 语音 | LiveKit Cloud |
|---|---|---|
| 订阅费 | 无 | Build $0 / Ship $50 / Scale $500 |
| 免费额度 | **10,000 分钟/月** | 5,000 WebRTC 分钟/月(Build) |
| 按量 | $0.99 / 1000 分钟 | 计入 WebRTC 分钟 + 带宽 |
| 并发 | 语音无 50 限制(那是 Chat 免费档) | Build 100 并发连接 |
| 纯语音支持 | ✅ | ✅(WebRTC 普通参与者分钟,非 AI/agent 计费) |

按护栏(单场≤30min、经纪≤3h/天),Agora 1 万免费分钟 ≈ 每月 ~83h 双人通话全免费,demo 花不到钱。

## 中国跨境(决定性)
- **Agora**:中国大陆自建边缘节点 + ICP,走私有专网,中国↔海外是看家本领。
- **LiveKit Cloud**:节点 = 美东(弗吉尼亚)/ 法兰克福 / 孟买,**无中国大陆**;大陆流量绕远,质量不可控,无 ICP。

## "$350" 真相
Agora **Chat(即时通讯)** 才有月费档位(约 $45.99–$1,217.99)+ 免费档 "50 peak concurrent connections"。**Voice Calling 是独立产品,纯按量、无订阅。**用户把 Chat 的价目当成了语音的。

## 决策
- 有大陆中国买家 → **Agora**(成本顾虑不成立 + 中国质量 + 已集成完成,换 LiveKit 是无谓重做)。
- 客户完全不在大陆 → 两家皆可;为"纯语音"换掉已建好的 Agora 不划算,除非看重 LiveKit 的 AI roadmap。

## Sources
- https://www.agora.io/en/pricing/
- https://docs.agora.io/en/agora-chat/reference/pricing-plan-details
- https://livekit.com/pricing
- https://docs.livekit.io/intro/cloud/
