# 🖼️ 图片数据流说明

## 📊 当前实现方式

### Base64 + SSE 传输

```
后端提取图片
    ↓
转换为 base64 字符串
    ↓
包含在 buildingData 中
    ↓
通过 SSE 发送到前端
    ↓
前端直接显示（<img src={base64} />）
```

**优点**：
- ✅ 不需要文件服务器
- ✅ 图片直接嵌入数据
- ✅ 前端即时显示

**缺点**：
- ⚠️ Base64 很大（+33% 大小）
- ⚠️ SSE 可能超时
- ⚠️ 内存占用高

---

## 🔧 可能的问题

### 问题 1：Base64 数据太大

**症状**：
```
提取了 15 张图片
每张 500KB → 15 × 500KB = 7.5MB
Base64 后 → 10MB 数据通过 SSE
→ 可能超时或失败
```

**解决方案 A**：压缩图片
```typescript
// 在提取时压缩
import sharp from 'sharp';

const compressed = await sharp(imageBuffer)
  .resize(800, 800, { fit: 'inside' })
  .jpeg({ quality: 70 })
  .toBuffer();
```

**解决方案 B**：先保存到服务器，发送 URL
```typescript
// 保存图片到 uploads/images/
const imageUrl = `/api/images/${jobId}/image_${index}.jpg`;

// 发送 URL 而不是 base64
buildingData.images = {
  projectImages: [
    'http://localhost:3000/api/images/job123/img1.jpg',
    'http://localhost:3000/api/images/job123/img2.jpg',
  ]
}
```

---

## ✅ 推荐方案：混合模式

### 小图片 → Base64（即时显示）
### 大图片 → URL（延迟加载）

```typescript
if (imageSize < 200KB) {
  return base64String;  // 直接发送
} else {
  saveToServer(image);
  return imageUrl;      // 发送 URL
}
```

---

## 🚀 快速修复

让我实现一个优化版本...
