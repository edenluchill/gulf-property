# 🔧 环境变量配置指南

## 📋 必需配置清单

### ✅ 立即需要（核心功能）

#### 1. 数据库配置
```env
DB_HOST=localhost
DB_PORT=5432
DB_NAME=gulf_property
DB_USER=gulf_admin
DB_PASSWORD=your_database_password_here
```

#### 2. 服务器配置
```env
PORT=3000
NODE_ENV=development
CORS_ORIGIN=http://localhost:5173
```

#### 3. AI API（PDF 处理）
```env
# Google Gemini（推荐 - 免费 1500 次/天）
GEMINI_API_KEY=your_gemini_api_key_here
```

**获取 Gemini API Key：**
1. 访问：https://aistudio.google.com/app/apikey
2. 登录 Google 账号
3. 点击 "Create API Key"
4. 复制密钥

---

### ⏳ 可选配置（后续添加）

#### 图片存储（暂时用本地，稍后配置）
```env
# 选项 1: Cloudflare R2（推荐 - 免费 10GB）
# CLOUDFLARE_ACCOUNT_ID=your_account_id
# CLOUDFLARE_ACCESS_KEY_ID=your_access_key
# CLOUDFLARE_SECRET_ACCESS_KEY=your_secret_key
# CLOUDFLARE_R2_BUCKET=gulf-property-images

# 选项 2: Supabase Storage（推荐 - 免费 1GB）
# SUPABASE_URL=https://your-project.supabase.co
# SUPABASE_SERVICE_KEY=your_service_key
# SUPABASE_STORAGE_BUCKET=property-images
```

**注意：** 图片存储现在默认使用本地（`backend/uploads/images/`），无需配置。

---

## 🚀 完整 .env 文件模板

### 复制这个到 `backend/.env`：

```env
# ====================================
# 核心配置（必需）
# ====================================

# 服务器
PORT=3000
NODE_ENV=development

# CORS（前端地址）
CORS_ORIGIN=http://localhost:5173

# 数据库
DB_HOST=localhost
DB_PORT=5432
DB_NAME=gulf_property
DB_USER=gulf_admin
DB_PASSWORD=在这里填写你的数据库密码

# ====================================
# AI 处理（必需 - 用于 PDF 提取）
# ====================================

# Google Gemini API
# 获取：https://aistudio.google.com/app/apikey
# 免费额度：1500 次/天
GEMINI_API_KEY=在这里填写你的Gemini_API_Key

# ====================================
# 图片存储（可选 - 暂时不需要）
# ====================================

# 当前使用本地存储，无需配置
# 图片保存在：backend/uploads/images/
# 图片访问：http://localhost:3000/api/images/xxx.jpg

# 未来可选配置（稍后添加）:
# - Cloudflare R2
# - Supabase Storage
# - Cloudinary

# ====================================
# API 限流（可选）
# ====================================

RATE_LIMIT_WINDOW_MS=900000
RATE_LIMIT_MAX_REQUESTS=100

# ====================================
# 日志（可选）
# ====================================

LOG_LEVEL=info
```

---

## ✅ 快速配置步骤

### 步骤 1：创建 .env 文件
```bash
cd backend
cp env.template .env
```

### 步骤 2：填写必需配置

**2.1 数据库密码**
```env
DB_PASSWORD=你的数据库密码
```

找到密码：
- 查看 `database-credentials.txt`
- 或查看 `backend/.env.database`

**2.2 Gemini API Key**
```env
GEMINI_API_KEY=AIzaSy...
```

获取方式：
1. 访问：https://aistudio.google.com/app/apikey
2. 点击 "Create API Key"
3. 复制粘贴

### 步骤 3：验证配置
```bash
# 启动服务
npm run dev

# 看到这些就成功了：
# ✅ 数据库连接成功
# ✅ Gemini API 配置成功
# ✅ 图片目录创建成功
```

---

## 🎯 配置优先级

### 🔴 必须立即配置（否则无法运行）
```
1. DB_PASSWORD     ← 数据库密码
2. GEMINI_API_KEY  ← AI PDF 处理
```

### 🟡 建议配置（提升体验）
```
3. CORS_ORIGIN     ← 前端地址（默认已设置）
4. PORT            ← 后端端口（默认 3000）
```

### 🟢 可选配置（稍后添加）
```
5. 图片存储配置    ← 暂时用本地（已可用）
6. 限流配置        ← 防止滥用（已有默认值）
```

---

## 🔍 配置检查

### 检查数据库连接
```bash
# 方法 1：启动服务看日志
npm run dev
# 应该看到：✅ Database connected

# 方法 2：运行测试脚本
npm run test:db
```

### 检查 Gemini API
```bash
# 启动服务后上传 PDF 测试
# 看到这个就成功：
# 📸 Processing PDF with Gemini Flash...
# ✅ Received response from Gemini
```

### 检查图片存储
```bash
# 启动服务
npm run dev

# 看到这个就成功：
# 📁 Upload directory ready: .../backend/uploads/images
```

---

## 🚨 常见问题

### Q: 没有数据库密码怎么办？
**A:** 运行数据库部署脚本：
```bash
.\deploy-database.ps1
# 密码会保存在 database-credentials.txt
```

### Q: Gemini API Key 是免费的吗？
**A:** 是的！每天 1500 次请求，永久免费。
- 访问：https://aistudio.google.com/app/apikey
- 只需 Google 账号，无需信用卡

### Q: 图片必须配置 Cloudflare 或 Supabase 吗？
**A:** 不需要！现在默认用本地存储，完全可用：
- 图片保存在：`backend/uploads/images/`
- 前端访问：`/api/images/xxx.jpg`
- 稍后可以随时切换到云存储

### Q: 如何知道配置成功？
**A:** 启动服务看日志：
```bash
npm run dev

# 成功的日志：
🚀 Server running on port 3000
📍 Environment: development
🌐 CORS enabled for: http://localhost:5173
✅ Database connected
☁️ Gemini configured successfully
📁 Upload directory ready
```

---

## 📊 环境变量总结

| 变量 | 状态 | 说明 |
|------|------|------|
| `DB_*` | 🔴 必需 | 数据库连接 |
| `GEMINI_API_KEY` | 🔴 必需 | AI PDF 处理 |
| `PORT` | 🟡 可选 | 默认 3000 |
| `CORS_ORIGIN` | 🟡 可选 | 默认 localhost:5173 |
| `CLOUDFLARE_*` | 🟢 未来 | 暂时不需要 |
| `SUPABASE_*` | 🟢 未来 | 暂时不需要 |

---

## 🎉 最小配置（立即可用）

**只需配置这 2 个变量：**

```env
DB_PASSWORD=你的数据库密码
GEMINI_API_KEY=你的Gemini_API_Key
```

**其他都有默认值，无需配置！**

---

## 📝 下一步

1. ✅ 复制 `env.template` 到 `.env`
2. ✅ 填写 `DB_PASSWORD`
3. ✅ 填写 `GEMINI_API_KEY`
4. ✅ 运行 `npm run dev`
5. ✅ 测试 PDF 上传功能
6. 🚀 完成！

**图片存储稍后再说，现在本地存储完全够用！**

---

**需要帮助？**
- 数据库配置：查看 `database-credentials.txt`
- Gemini API：访问 https://aistudio.google.com/app/apikey
- 问题排查：查看终端日志输出

开始配置吧！🚀
