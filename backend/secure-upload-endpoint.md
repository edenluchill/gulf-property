# 保护 DNS-only 上传端点的安全措施

## 问题
`upload.pinzos.com` 使用 DNS only（不经过 Cloudflare），需要额外的安全保护。

---

## 🔒 安全措施清单

### 1. Hetzner 防火墙 - 限制访问来源

在 Hetzner 中为 Load Balancer 添加防火墙规则：

```bash
# 只允许特定国家/地区访问上传端点
# 例如：UAE, 中国, 美国

# 通过 Hetzner Console 设置：
# Firewall → Create Rule
# - Service: HTTPS (443)
# - Source: Select Countries (UAE, CN, US, etc.)
# - Target: Load Balancer
```

### 2. Nginx 速率限制 - 防止滥用

在 `nginx.production.conf` 中添加上传端点的速率限制：

```nginx
http {
    # 定义速率限制区域（基于 IP）
    limit_req_zone $binary_remote_addr zone=upload_limit:10m rate=5r/m;
    
    # 定义连接数限制
    limit_conn_zone $binary_remote_addr zone=upload_conn:10m;
    
    server {
        listen 443 ssl http2;
        server_name api.pinzos.com;
        
        # 上传端点特殊限制
        location /api/langgraph-progress/start {
            # 每分钟最多 5 个请求
            limit_req zone=upload_limit burst=10 nodelay;
            
            # 每个 IP 最多 3 个并发连接
            limit_conn upload_conn 3;
            
            # 其他配置...
            proxy_pass http://backend;
        }
    }
}
```

### 3. 后端认证 - API Key 验证

为上传端点添加 API Key 认证：

**更新 `.env.production`：**
```env
UPLOAD_API_KEY=your-secure-random-key-here-use-uuid
```

**更新 `langgraph-progress.ts`：**
```typescript
router.post(
  '/start',
  (req, res, next) => {
    const apiKey = req.headers['x-api-key'];
    const validKey = process.env.UPLOAD_API_KEY;
    
    if (!apiKey || apiKey !== validKey) {
      return res.status(401).json({
        success: false,
        error: 'Unauthorized: Invalid or missing API key'
      });
    }
    next();
  },
  uploadMultiple.array('files', 10),
  async (req: Request, res: Response) => {
    // ... 上传逻辑
  }
);
```

**前端添加 API Key：**
```typescript
const formData = new FormData();
files.forEach(file => formData.append('files', file));

const response = await fetch(uploadEndpoint, {
  method: 'POST',
  headers: {
    'X-API-Key': process.env.VITE_UPLOAD_API_KEY,
  },
  body: formData,
});
```

### 4. IP 白名单（可选，适合内部使用）

如果上传功能只给特定用户：

**Nginx 配置：**
```nginx
location /api/langgraph-progress/start {
    # 只允许特定 IP
    allow 203.0.113.10;      # 办公室 IP
    allow 198.51.100.0/24;   # VPN 网段
    deny all;
    
    proxy_pass http://backend;
}
```

### 5. 文件验证 - 防止恶意上传

**后端验证（已有，可增强）：**
```typescript
const uploadMultiple = multer({
  storage: multer.memoryStorage(),
  limits: { 
    fileSize: 500 * 1024 * 1024,
    files: 10,
  },
  fileFilter: (_req, file, cb) => {
    // 严格验证 MIME 类型
    if (file.mimetype !== 'application/pdf') {
      return cb(new Error('Only PDF files are allowed'));
    }
    
    // 验证文件扩展名
    const ext = file.originalname.toLowerCase().split('.').pop();
    if (ext !== 'pdf') {
      return cb(new Error('Invalid file extension'));
    }
    
    cb(null, true);
  },
});

// 添加额外的文件内容验证
router.post('/start', uploadMultiple.array('files', 10), async (req, res) => {
  const files = req.files as Express.Multer.File[];
  
  for (const file of files) {
    // 验证 PDF magic number
    const header = file.buffer.slice(0, 5).toString();
    if (header !== '%PDF-') {
      return res.status(400).json({
        success: false,
        error: `Invalid PDF file: ${file.originalname}`
      });
    }
  }
  
  // ... 继续处理
});
```

### 6. 监控和告警

**设置 Hetzner 监控：**
- CPU 使用率 > 80%
- 带宽异常飙升
- 磁盘空间不足

**日志监控：**
```bash
# 监控异常上传尝试
tail -f /var/log/nginx/error.log | grep -i "413\|429\|401"

# 监控大文件上传
tail -f /var/log/nginx/access.log | grep "langgraph-progress/start"
```

### 7. Fail2ban - 自动封禁

**安装 Fail2ban（SSH 到服务器）：**
```bash
apt-get install fail2ban

# 配置 Nginx 过滤器
cat > /etc/fail2ban/filter.d/nginx-upload.conf << 'EOF'
[Definition]
failregex = ^<HOST> -.*"POST /api/langgraph-progress/start HTTP.*" (401|413|429)
ignoreregex =
EOF

# 配置 jail
cat >> /etc/fail2ban/jail.local << 'EOF'
[nginx-upload]
enabled = true
port = http,https
filter = nginx-upload
logpath = /var/log/nginx/access.log
maxretry = 5
bantime = 3600
findtime = 600
EOF

systemctl restart fail2ban
```

---

## 🎯 推荐配置（分级）

### Level 1 - 基础保护（必须）
- ✅ Nginx 速率限制（每 IP 每分钟 5 次）
- ✅ 文件类型和大小验证
- ✅ HTTPS 强制

### Level 2 - 中级保护（推荐）
- ✅ Level 1 所有措施
- ✅ API Key 认证
- ✅ Hetzner 防火墙（地理位置限制）
- ✅ 监控告警

### Level 3 - 高级保护（生产环境）
- ✅ Level 2 所有措施
- ✅ IP 白名单（如果适用）
- ✅ Fail2ban 自动封禁
- ✅ 文件内容深度验证（PDF magic number）

---

## 🚀 实施步骤

1. **立即实施（5 分钟）**
   ```bash
   # 运行更新脚本
   cd backend
   .\fix-nginx-upload-limit.ps1
   ```

2. **添加速率限制（10 分钟）**
   - 更新 `nginx.production.conf`
   - 重新部署

3. **添加 API Key 认证（15 分钟）**
   - 更新后端代码
   - 更新前端代码
   - 重新部署

4. **配置防火墙（5 分钟）**
   - 在 Hetzner Console 设置

5. **设置监控（10 分钟）**
   - 配置 Hetzner 告警
   - 设置日志监控

**总计时间：约 45 分钟**

---

## ⚖️ 权衡分析

| 方案 | 安全性 | 成本 | 复杂度 | 上传限制 |
|------|--------|------|--------|----------|
| **全部 Proxied** | ⭐⭐⭐⭐⭐ | $0-200/月 | ⭐ | 100-200MB |
| **DNS only + 上述保护** | ⭐⭐⭐⭐ | $0 | ⭐⭐⭐ | 500MB |
| **混合（推荐）** | ⭐⭐⭐⭐⭐ | $0 | ⭐⭐ | 500MB |

---

## 💡 最终建议

**使用混合方案 + Level 2 保护：**

1. `api.pinzos.com` → Proxied（保护所有常规 API）
2. `upload.pinzos.com` → DNS only（仅上传）+ API Key + 速率限制

**这样可以：**
- ✅ 主 API 受 Cloudflare 全面保护
- ✅ 上传功能支持 500MB
- ✅ 成本：$0
- ✅ 安全性：可接受
- ✅ 实施难度：中等

---

## 需要自动化脚本？

如果您需要，我可以为您创建：
1. Nginx 配置生成脚本（带速率限制）
2. API Key 认证中间件
3. 自动化监控脚本
4. Fail2ban 一键安装脚本

请告诉我您需要哪些！
