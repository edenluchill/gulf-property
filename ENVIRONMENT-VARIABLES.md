# 🔧 环境变量配置清单

## ⚡ 快速配置（只需 2 个变量）

### 必需配置：

```env
# 1. 数据库密码
DB_PASSWORD=你的数据库密码

# 2. Gemini API Key
GEMINI_API_KEY=你的Gemini_API_Key
```

**就这两个！其他都有默认值。**

---

## 📋 完整配置文件

### 创建 `backend/.env` 文件，内容如下：

```env
# ==========================================
# 核心配置（必需）
# ==========================================

# 服务器
PORT=3000
NODE_ENV=development
CORS_ORIGIN=http://localhost:5173

# 数据库
DB_HOST=localhost
DB_PORT=5432
DB_NAME=gulf_property
DB_USER=gulf_admin
DB_PASSWORD=在这里填写你的数据库密码

# AI 处理
GEMINI_API_KEY=在这里填写你的Gemini_API_Key

# ==========================================
# 可选配置（暂时不需要）
# ==========================================

# API 限流
RATE_LIMIT_WINDOW_MS=900000
RATE_LIMIT_MAX_REQUESTS=100

# 日志
LOG_LEVEL=info
```

---

## 🔑 如何获取配置值

### 1. 数据库密码 (DB_PASSWORD)

**选项 A：查看已有文件**
```bash
# 查看这些文件中的任意一个：
cat database-credentials.txt
cat backend/.env.database
```

**选项 B：重新部署数据库**
```bash
.\deploy-database.ps1
# 密码会显示并保存到 database-credentials.txt
```

### 2. Gemini API Key (GEMINI_API_KEY)

**步骤：**
1. 访问：https://aistudio.google.com/app/apikey
2. 登录 Google 账号
3. 点击 "Create API Key"
4. 复制密钥（格式：`AIzaSy...`）

**特点：**
- ✅ 完全免费（1500 次/天）
- ✅ 只需 Google 账号
- ✅ 无需信用卡
- ✅ 2 分钟搞定

---

## 🚀 配置步骤

### 步骤 1：创建配置文件
```bash
cd backend
notepad .env
# 或
code .env
```

### 步骤 2：复制模板
```env
PORT=3000
NODE_ENV=development
CORS_ORIGIN=http://localhost:5173

DB_HOST=localhost
DB_PORT=5432
DB_NAME=gulf_property
DB_USER=gulf_admin
DB_PASSWORD=

GEMINI_API_KEY=
```

### 步骤 3：填写两个必需值
```env
DB_PASSWORD=你从 database-credentials.txt 找到的密码
GEMINI_API_KEY=你从 Google AI Studio 获取的密钥
```

### 步骤 4：保存并测试
```bash
npm run dev
```

**成功输出：**
```
🚀 Server running on port 3000
📍 Environment: development
✅ Database connected
☁️ Gemini configured successfully
📁 Upload directory ready
```

---

## 📸 图片存储说明

### 当前状态：本地存储（默认）

**配置：** 无需配置  
**位置：** `backend/uploads/images/`  
**访问：** `http://localhost:3000/api/images/xxx.jpg`  
**状态：** ✅ 立即可用

### 未来选项（稍后配置）

你提到想用 **Cloudflare 或 Supabase**，完全可以！

#### 选项 1：Cloudflare R2
```env
CLOUDFLARE_ACCOUNT_ID=your_account_id
CLOUDFLARE_ACCESS_KEY_ID=your_access_key
CLOUDFLARE_SECRET_ACCESS_KEY=your_secret_key
CLOUDFLARE_R2_BUCKET=gulf-property-images
```

**特点：**
- 免费 10GB 存储
- 无出口费用
- S3 兼容

#### 选项 2：Supabase Storage
```env
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_SERVICE_KEY=your_service_key
SUPABASE_STORAGE_BUCKET=property-images
```

**特点：**
- 免费 1GB 存储
- 自动 CDN
- 简单集成

**现在不需要配置这些，本地存储已经可用！**

---

## ✅ 配置检查清单

- [ ] 创建了 `backend/.env` 文件
- [ ] 填写了 `DB_PASSWORD`
- [ ] 填写了 `GEMINI_API_KEY`
- [ ] 运行了 `npm run dev`
- [ ] 看到成功启动日志
- [ ] 可以访问 http://localhost:3000/health

---

## 🎯 环境变量优先级

### 🔴 必须配置（否则无法运行）
```
1. DB_PASSWORD     ← 数据库密码
2. GEMINI_API_KEY  ← PDF 处理必需
```

### 🟢 可选配置（有默认值）
```
3. PORT            ← 默认 3000
4. CORS_ORIGIN     ← 默认 http://localhost:5173
5. 其他限流/日志   ← 都有合理默认值
```

### ⏳ 未来配置（暂不需要）
```
6. 图片存储配置    ← 现在用本地，够用
7. 其他云服务      ← 需要时再添加
```

---

## 🚨 常见问题

### Q: 找不到数据库密码？
```bash
# 查看文件
cat database-credentials.txt

# 或重新生成
.\deploy-database.ps1
```

### Q: Gemini API Key 在哪里？
```
https://aistudio.google.com/app/apikey
点击 Create API Key
```

### Q: 必须配置图片存储吗？
```
不需要！现在默认用本地存储，完全可用。
稍后可以切换到 Cloudflare 或 Supabase。
```

### Q: 如何验证配置正确？
```bash
npm run dev

# 看到这些就对了：
✅ Database connected
☁️ Gemini configured successfully
📁 Upload directory ready
```

---

## 📝 配置文件示例

### 最小可用配置：
```env
DB_PASSWORD=abc123xyz
GEMINI_API_KEY=AIzaSyD123456789abcdefg
```

### 推荐完整配置：
```env
PORT=3000
NODE_ENV=development
CORS_ORIGIN=http://localhost:5173

DB_HOST=localhost
DB_PORT=5432
DB_NAME=gulf_property
DB_USER=gulf_admin
DB_PASSWORD=abc123xyz

GEMINI_API_KEY=AIzaSyD123456789abcdefg

RATE_LIMIT_WINDOW_MS=900000
RATE_LIMIT_MAX_REQUESTS=100
LOG_LEVEL=info
```

---

## 🎉 完成后

1. ✅ 配置完成
2. ✅ 启动服务：`npm run dev`
3. ✅ 运行迁移：`npm run migrate:developer`
4. ✅ 测试上传 PDF
5. ✅ 开始开发！

**图片存储现在用本地，完全够用。稍后想换 Cloudflare 或 Supabase 都可以！**

---

需要帮助？查看：
- **ENV-SETUP-GUIDE.md** - 详细配置指南
- **GEMINI-SETUP-GUIDE.md** - Gemini API 详细说明
- **IMAGE-STORAGE-QUICKSTART.md** - 图片存储说明

开始配置吧！🚀
