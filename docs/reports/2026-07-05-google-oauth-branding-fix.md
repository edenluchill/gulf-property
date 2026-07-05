# Google 登录显示 supabase.co 而非 pinzos.com — 修复方案

日期:2026-07-05
问题:Google OAuth 登录页显示 "to continue to fpcjdocucokmzdpffiyq.supabase.co",客户以为是诈骗网站。

## 根因

Google "to continue to …" 显示的是 **OAuth 回调域名**。登录链路:

```
pinzos.com → accounts.google.com → fpcjdocucokmzdpffiyq.supabase.co/auth/v1/callback → www.pinzos.com/auth/callback
```

回调站在 supabase.co,且 Google Cloud 的 OAuth 应用品牌未做验证 → Google 防钓鱼策略强制显示原始回调域名。

## 修法一:Google 品牌验证(免费,显示「Pinzos」+ logo)⭐ 治本

Google Cloud Console → APIs & Services → OAuth consent screen (Branding):

1. App name = `Pinzos`,上传 logo,User support email 填正式邮箱
2. App domain:
   - Homepage: `https://www.pinzos.com`
   - Privacy policy: `https://www.pinzos.com/privacy`(页面必须真实存在)
   - Terms of service: `https://www.pinzos.com/terms`(同上)
3. Authorized domains 加 `pinzos.com`
4. Publishing status 必须是 **In production**(不是 Testing)
5. 上传 logo 后提交 brand verification,等 Google 审核(几天~两周)

通过后显示 "to continue to Pinzos" + logo。

**前置条件**:pinzos.com 上要有隐私政策和服务条款页面(如无,前端加 /privacy 和 /terms 静态页)。

## 修法二:Supabase 自定义域名($10/月,立即生效,显示自家域名)

Supabase Pro 的 Custom Domain 附加功能,项目 URL 换成 `auth.pinzos.com`:

1. Supabase Dashboard → Settings → Custom Domains → 填 `auth.pinzos.com`
2. Cloudflare DNS:
   - CNAME `auth` → `fpcjdocucokmzdpffiyq.supabase.co`(**灰云 DNS-only,不能开代理**)
   - 加 Supabase 给的 TXT 验证记录
3. Google OAuth client → Authorized redirect URIs 追加 `https://auth.pinzos.com/auth/v1/callback`(旧 supabase.co 的先保留,平滑切换)
4. 前端:Cloudflare Pages 环境变量 `VITE_SUPABASE_URL` → `https://auth.pinzos.com`,重新部署
5. 后端:`.env` 的 `SUPABASE_URL` 同步改;**注意服务器 /opt/pinzos/docker-compose.yml 的 env 映射坑**(新值要确认 compose 有映射)

之后登录页显示 "to continue to auth.pinzos.com"。

## 建议

两个都做:修法一给品牌名和 logo(最正规),修法二立即生效兜底。零成本路径 = 只做修法一,等审核。

## 相关代码位置

- 前端 Supabase client:`frontend/src/lib/supabase.ts`(读 `VITE_SUPABASE_URL`)
- OAuth 回调页:`www.pinzos.com/auth/callback`(2026-06-24 重写过,见 login-resilience 记录)
