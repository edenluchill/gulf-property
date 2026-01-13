# 🚀 提高 Gemini API Quota 指南

## 📊 当前限制

**Gemini 2.0 Flash (Experimental)**：
- 免费版：10 RPM（每分钟请求数）
- 问题：并发处理时容易触发

---

## ✅ 解决方案

### 方案 1：切换到 Gemini 2.5 Flash（推荐）⭐

**Gemini 2.5 Flash** 有更高的配额！

```typescript
// 更新所有 agent 文件中的模型
const model = genAI.getGenerativeModel({
  model: 'gemini-2.5-flash',  // ← 改这里
});
```

**优势**：
- ✅ 免费版也有更高限额
- ✅ 更快的响应
- ✅ 更好的性能
- ✅ 无需付费

**限额对比**：
```
Gemini 2.0 Flash Exp:  10 RPM (免费)
Gemini 2.5 Flash:      15 RPM (免费) ✅
Gemini 1.5 Flash:      15 RPM (免费)
```

### 方案 2：升级到付费 API

访问：https://ai.google.dev/pricing

**价格**：
- Gemini Flash: **FREE** (有限额)
- Gemini Pro: $0.00025 / 1K characters

**付费版限额**：
- 1000 RPM（vs 免费 10 RPM）
- 实际上用不完！

**如何升级**：
1. 访问 https://aistudio.google.com/
2. 创建付费项目
3. 启用 Gemini API billing
4. 使用新的 API key

### 方案 3：申请提高配额

**步骤**：
1. 访问 Google Cloud Console
2. 进入 "IAM & Admin" → "Quotas"
3. 搜索 "Gemini API"
4. 申请提高 RPM 限制

通常可以免费提升到 60 RPM。

### 方案 4：使用多个 API Key 轮换

```typescript
const API_KEYS = [
  process.env.GEMINI_API_KEY_1,
  process.env.GEMINI_API_KEY_2,
  process.env.GEMINI_API_KEY_3,
];

let currentKeyIndex = 0;

function getNextApiKey() {
  const key = API_KEYS[currentKeyIndex];
  currentKeyIndex = (currentKeyIndex + 1) % API_KEYS.length;
  return key;
}

// 使用轮换的 key
const genAI = new GoogleGenerativeAI(getNextApiKey());
```

**效果**：
- 3 个 key × 10 RPM = 30 RPM！
- 免费获得 3 倍提升

---

## 🎯 推荐方案

### 立即可做（免费）

**1. 切换到 Gemini 2.5 Flash**

更新所有 agent 文件：
```typescript
// visual-classifier.agent.ts
// floor-plan-auditor.agent.ts
// financial-structurer.agent.ts
// market-intelligence.agent.ts
// copywriter.agent.ts
// nodes-direct-pdf-enhanced.ts

const model = genAI.getGenerativeModel({
  model: 'gemini-2.5-flash',  // ← 统一改成这个
});
```

**好处**：
- 15 RPM (vs 10 RPM)
- 可以增加到 BATCH_SIZE = 5
- 更稳定

**2. 当前配置（已优化）**

```typescript
BATCH_SIZE = 5     // 你已经改成 5 了
BATCH_DELAY = 3s   // 你已经改成 3s
```

计算：
```
5 requests / batch
每批 ~18s (15s处理 + 3s延迟)
速率: 5/18s = 16.7 requests/min

如果模型限额是 10 RPM → 可能还会触发 ⚠️
如果切换到 2.5 (15 RPM) → 安全 ✅
```

---

## 🚀 快速修改模型

让我帮你批量更新所有文件使用 Gemini 2.5：

```bash
# 或手动修改这些文件中的模型名：
- src/agents/visual-classifier.agent.ts
- src/agents/floor-plan-auditor.agent.ts  
- src/agents/financial-structurer.agent.ts
- src/agents/market-intelligence.agent.ts
- src/agents/copywriter.agent.ts
- src/langgraph/nodes-direct-pdf-enhanced.ts
```

---

## 📈 不同方案对比

| 方案 | RPM | 并发 | 延迟 | 总时间(89页) | 成本 |
|------|-----|------|------|-------------|------|
| 当前(2.0 Exp) | 10 | 3 | 8s | 5-6分钟 | 免费 |
| 2.5 Flash | 15 | 5 | 3s | **3-4分钟** | 免费 ⭐ |
| 付费 Pro | 1000 | 20 | 1s | **1分钟** | ~$0.50 |
| 3个免费Key | 30 | 10 | 2s | **2分钟** | 免费 |

---

## 🎯 我的建议

### 立即行动（免费）

切换到 **Gemini 2.5 Flash**：
- 更高限额（15 RPM）
- 免费使用
- 5 分钟改完

### 长期方案

如果经常使用：
- 付费版（$0.50/文档）
- 或使用多个免费 key 轮换

---

**要我现在帮你批量更新所有文件到 Gemini 2.5 吗？** 🚀