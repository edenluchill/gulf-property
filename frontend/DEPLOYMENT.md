# Gulf Property Frontend - 部署指南

## 环境变量配置

前端使用 Vite 的环境变量系统。根据部署环境创建对应的 `.env` 文件：

### 开发环境 (`.env.development`)

```env
VITE_API_URL=http://localhost:3000
```

### 生产环境 (`.env.production`)

```env
VITE_API_URL=https://api.gulf-property.com
```

### 自定义环境变量

如果需要覆盖默认配置，创建 `.env.local`：

```env
VITE_API_URL=http://localhost:3000
```

**注意**: `.env.local` 文件不会被提交到 Git（已在 `.gitignore` 中）

---

## 部署到 Vercel

### 1. 安装 Vercel CLI

```bash
npm i -g vercel
```

### 2. 登录 Vercel

```bash
vercel login
```

### 3. 部署

```bash
# 测试部署
vercel

# 生产部署
vercel --prod
```

### 4. 配置环境变量

在 Vercel Dashboard 中:
- **Settings** → **Environment Variables**
- 添加: `VITE_API_URL` = `https://api.gulf-property.com`
- 环境: **Production**

### 5. 绑定自定义域名

在 Vercel Dashboard 中:
- **Settings** → **Domains**
- 添加: `gulf-property.com` 和 `www.gulf-property.com`

---

## 部署到 Cloudflare Pages

### 1. 构建应用

```bash
npm run build
```

### 2. 安装 Wrangler CLI

```bash
npm i -g wrangler
```

### 3. 登录 Cloudflare

```bash
wrangler login
```

### 4. 部署

```bash
wrangler pages deploy dist --project-name=gulf-property
```

### 5. 配置环境变量

在 Cloudflare Pages Dashboard 中:
- **Settings** → **Environment variables**
- 添加: `VITE_API_URL` = `https://api.gulf-property.com`

### 6. 绑定自定义域名

在 Cloudflare Pages Dashboard 中:
- **Custom domains** → 添加 `gulf-property.com`

---

## 部署到 Netlify

### 1. 安装 Netlify CLI

```bash
npm i -g netlify-cli
```

### 2. 登录 Netlify

```bash
netlify login
```

### 3. 初始化项目

```bash
netlify init
```

### 4. 部署

```bash
# 构建并部署
npm run build
netlify deploy --prod --dir=dist
```

### 5. 配置环境变量

在 Netlify Dashboard 中:
- **Site settings** → **Environment variables**
- 添加: `VITE_API_URL` = `https://api.gulf-property.com`

### 6. 绑定自定义域名

在 Netlify Dashboard 中:
- **Domain settings** → **Add custom domain** → `gulf-property.com`

---

## 部署到 Hetzner (静态托管)

### 1. 构建应用

```bash
npm run build
```

### 2. 设置环境变量

```bash
# Windows PowerShell
$env:VITE_API_URL="https://api.gulf-property.com"
npm run build

# Linux/Mac
VITE_API_URL=https://api.gulf-property.com npm run build
```

### 3. 上传到服务器

```bash
# 使用 SCP
scp -r dist/* root@your-server-ip:/var/www/gulf-property

# 或使用 rsync
rsync -avz dist/ root@your-server-ip:/var/www/gulf-property/
```

### 4. 配置 Nginx

在服务器上创建 `/etc/nginx/sites-available/gulf-property`:

```nginx
server {
    listen 80;
    server_name gulf-property.com www.gulf-property.com;

    root /var/www/gulf-property;
    index index.html;

    # SPA routing
    location / {
        try_files $uri $uri/ /index.html;
    }

    # Gzip compression
    gzip on;
    gzip_vary on;
    gzip_types text/plain text/css text/javascript application/javascript application/json;

    # Cache static assets
    location ~* \.(js|css|png|jpg|jpeg|gif|ico|svg|woff|woff2|ttf|eot)$ {
        expires 1y;
        add_header Cache-Control "public, immutable";
    }
}
```

启用站点:

```bash
ln -s /etc/nginx/sites-available/gulf-property /etc/nginx/sites-enabled/
nginx -t
systemctl reload nginx
```

### 5. 配置 SSL (Let's Encrypt)

```bash
apt-get install -y certbot python3-certbot-nginx
certbot --nginx -d gulf-property.com -d www.gulf-property.com
```

---

## 环境变量说明

### `VITE_API_URL`

- **用途**: 后端 API 的基础 URL
- **开发环境**: `http://localhost:3000`
- **生产环境**: `https://api.gulf-property.com`
- **注意**: 
  - 必须包含协议（`http://` 或 `https://`）
  - 不要在末尾加斜杠 `/`
  - 改变后需要重新构建应用

---

## 验证部署

### 1. 检查 API 连接

打开浏览器开发者工具 → **Network** 面板:
- 检查 API 请求是否发送到正确的域名
- 确认请求返回 200 状态码

### 2. 检查 CORS

确保后端 `.env.production` 中的 `CORS_ORIGIN` 包含前端域名:

```env
CORS_ORIGIN=https://gulf-property.com,https://www.gulf-property.com
```

### 3. 测试功能

- ✅ 地图加载正常
- ✅ 搜索功能工作
- ✅ 项目详情页显示
- ✅ 开发者上传功能正常

---

## 故障排查

### API 请求失败

**问题**: Network 面板显示请求到 `localhost:3000`

**解决**:
1. 检查 `.env.production` 文件存在且配置正确
2. 重新构建: `npm run build`
3. 清除浏览器缓存

### CORS 错误

**问题**: Console 显示 CORS policy 错误

**解决**:
1. 确保后端 `CORS_ORIGIN` 包含前端域名
2. 检查协议是否匹配（都是 HTTPS）
3. 重启后端服务

### 页面刷新 404

**问题**: SPA 路由在刷新时返回 404

**解决**:
- **Vercel/Netlify**: 自动处理，无需配置
- **Cloudflare Pages**: 自动处理
- **Nginx**: 确保配置了 `try_files $uri $uri/ /index.html;`

---

## 性能优化

### 1. 代码分割

Vite 自动进行代码分割，无需额外配置。

### 2. 图片优化

使用 WebP 格式并设置适当的缓存头。

### 3. CDN

- Vercel: 自动使用全球 CDN
- Cloudflare Pages: 自动使用 Cloudflare CDN
- Netlify: 自动使用全球 CDN

### 4. 懒加载

组件已配置懒加载（React.lazy）。

---

## 监控和分析

### Vercel Analytics

```bash
npm install @vercel/analytics
```

```typescript
// main.tsx
import { Analytics } from '@vercel/analytics/react';

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
    <Analytics />
  </React.StrictMode>
);
```

### Cloudflare Web Analytics

在 Cloudflare Pages Dashboard 中启用 Web Analytics。

---

## 自动部署 (CI/CD)

### GitHub Actions (Vercel)

创建 `.github/workflows/deploy.yml`:

```yaml
name: Deploy to Vercel

on:
  push:
    branches: [main]

jobs:
  deploy:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v3
      - uses: actions/setup-node@v3
        with:
          node-version: 18
      - run: npm ci
      - run: npm run build
      - uses: amondnet/vercel-action@v25
        with:
          vercel-token: ${{ secrets.VERCEL_TOKEN }}
          vercel-org-id: ${{ secrets.ORG_ID }}
          vercel-project-id: ${{ secrets.PROJECT_ID }}
          vercel-args: '--prod'
```

### Cloudflare Pages Git Integration

在 Cloudflare Pages Dashboard 中:
1. 连接 GitHub 仓库
2. 配置构建设置:
   - Build command: `npm run build`
   - Build output directory: `dist`
3. 每次推送到 main 分支时自动部署

---

## 回滚

### Vercel

```bash
vercel rollback
```

或在 Dashboard 中选择之前的部署版本。

### Cloudflare Pages

在 Dashboard 中查看部署历史并回滚。

### Netlify

```bash
netlify rollback
```

---

## 联系支持

- **Vercel**: https://vercel.com/support
- **Cloudflare**: https://support.cloudflare.com/
- **Netlify**: https://www.netlify.com/support/
