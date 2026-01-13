# 🚀 智能启动脚本

## ✅ 问题解决

**之前**：
```bash
npm run dev
❌ Error: EADDRINUSE: address already in use :::3000
(需要手动 kill 进程)
```

**现在**：
```bash
npm run dev
🔍 检查端口 3000...
⚠️  端口被占用
🔪 自动 kill 进程
✅ 进程已终止
🚀 启动开发服务器...
✅ Server running on port 3000
```

---

## 🎯 使用方法

### 方式 1：智能启动（推荐）⭐

```bash
cd backend
npm run dev
```

**自动执行**：
1. 检查端口 3000 是否被占用
2. 如果占用 → 自动 kill
3. 启动 dev server

### 方式 2：直接启动

```bash
npm run dev:direct
```

不做检查，直接启动（可能失败）

---

## 📁 新增文件

```
backend/
├── start-dev.ps1          # 智能启动脚本 ⭐
├── kill-backend.ps1       # 手动 kill 脚本（保留）
└── package.json           # 已更新
```

---

## 🔧 脚本逻辑

```powershell
1. 查找占用端口 3000 的进程
   ↓
2. 如果找到进程
   ├─ 显示进程 ID
   ├─ Kill 进程
   ├─ 等待 1 秒
   └─ 继续
   ↓
3. 启动 npm run dev:direct
```

---

## 🎯 好处

✅ **无需手动 kill** - 自动处理  
✅ **避免错误** - 端口冲突自动解决  
✅ **更快启动** - 一个命令搞定  
✅ **开发友好** - 改代码后直接 `npm run dev`  

---

## 🚀 现在试试

```bash
cd backend
npm run dev
```

应该看到：
```
🔍 Checking port 3000...
✅ Port 3000 is available
🚀 Starting development server...

[INFO] ts-node-dev ver. 2.0.0
🚀 Server running on port 3000
```

或如果端口被占用：
```
🔍 Checking port 3000...
⚠️  Port 3000 is in use by process 12345
🔪 Killing process 12345...
✅ Process killed successfully
🚀 Starting development server...

[INFO] ts-node-dev ver. 2.0.0
🚀 Server running on port 3000
```

---

**从此告别端口占用错误！** 🎉
