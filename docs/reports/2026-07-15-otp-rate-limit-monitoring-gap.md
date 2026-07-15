# 登录排查:邮箱验证码限流 + 监控盲区

日期:2026-07-15
触发:真实经纪 `dubai.erichenf@outlook.com` 在**微信 WebView** 内走邮箱验证码登录,
登录页报 `email rate limit exceeded`(截图来自 owner 微信)。

## 一、监控为什么没抓到(双盲)

1. **前端 OTP 发送路径无埋点。**
   `frontend/src/pages/LoginPage.tsx:47` 在 `signInWithOtp` 出错时只做 `setError(error.message)`
   显示到屏幕,不上报。现有 `auth_failure` 埋点只挂在 `/auth/callback`(OAuth/magic-link 回调),
   **"发送验证码"这一步失败对后端完全隐形**。
   - 验证:`app_events` 近 3 天搜 `erichenf` / `rate limit` = **0 条**;`auth_failure` 仅 3 条,
     全是 07-13 owner 自己在 `/auth/callback`(navigator.locks trap,见 memory)。

2. **限流不经过我们的服务器。**
   `frontend/src/contexts/AuthContext.tsx:212` 的 `signInWithOtp` 是浏览器**直连 Supabase**。
   `email rate limit exceeded` 是 Supabase 自身邮件限流,不碰 `api.pinzos.com`,
   所以 `perf_slow_requests` / `perf_alerts`(只监控 Express API)也看不见。

## 二、业务影响(比"没监控"更严重)

- 微信 WebView 里 Google 登录永远不可能成功(memory: wechat-webview-oauth)→ 邮箱验证码是唯一路。
- Supabase 默认共享 SMTP 邮件限额 ~3-4 封/小时 + 单邮箱冷却 → 唯一的路也被堵。
- 微信是推广有礼主渠道,此问题是**渠道经纪的转化杀手**,且我们零感知,只能靠用户截图发现。

## 三、7 天整体健康度(本次同批排查)

- 慢请求日志 7 天内**零 5xx**(只有 200/304)。
- 带真实 status 的服务端错误均为历史无复发:
  - 07-09 `POST /api/billing/checkout` 500 ×3 —— owner 测 Stripe 切 LIVE,无复发。
  - 07-11 `GET /api/residential-projects/:id` 500 ×4 —— 受影响全是 `cx-verify-*` 巡检测试号。
  - 07-14 `data-version`/`map-pins` 503 —— 部署重启瞬断。
- `auth_failure` = navigator.locks trap,仅 owner 自己,www 子域,普通用户未命中。
- 仍在响:HIGH_LATENCY(insights / ai-analytics/investment 慢查询,自愈)、DLD_*_STALE(源头停更)。

## 四、建议(两件一起)

| 类型 | 动作 | 效果 |
|------|------|------|
| 治本 | Supabase 接自建 SMTP(Resend/SES),限额 ~4/h → 数百~数千/h;前端"发送"按钮加本地 60s 冷却 + 友好文案 | 微信经纪真能登进来 |
| 补盲 | `signInWithOtp` 出错时上报 app_events(区分 rate_limit),纳入登录故障告警 | 下次当天可见,不靠截图 |

**止血优先级**:先做纯前端的「发送冷却 + OTP 失败埋点」(可立即部署);自建 SMTP 需 owner 在
Supabase 后台配置 Resend/SES 凭据。

## 相关代码
- `frontend/src/pages/LoginPage.tsx` — OTP 发送/校验 UI,错误处理在此
- `frontend/src/contexts/AuthContext.tsx:211` — `signInWithOtp`(直连 Supabase)

---

## 五、已修(2026-07-15,本次)

### 补盲 + 止血(前端,已提交待部署 / CF Pages git push 自动上线)
- 新增 `frontend/src/lib/authErrors.ts` —— `friendlyAuthError()` 把 `email rate limit exceeded`
  等原始英文翻成本地化文案;`isRateLimitError()` 识别限流。两个登录组件共用,防漂移。
- 新增 `frontend/src/hooks/useSendCooldown.ts` —— 「发送验证码」60s 本地冷却倒计时,
  从源头掐掉狂点(和 Supabase 单邮箱 ~60s 间隔对齐)。
- `AuthContext.signInWithOtp` —— **发送失败补埋点** `trackError('auth_failure',{reason:'otp_send'})`,
  进「错误监控」tab。下次这类问题当天可见,不再靠截图。
- `LoginPage.tsx` / `LoginDialog.tsx` —— 接冷却 + 友好文案;LoginPage OTP 步加「重发」入口。
- i18n:en/zh-CN 各加 errRateLimit / errInvalidEmail / errSignupDisabled / errGeneric / resendCode / resendIn。
- ✅ `tsc --noEmit` 通过;✅ `vite build` 通过。

### 治本(需 owner 操作,见第六节)
- Supabase 接自建 SMTP(Resend)+ 调高 Auth 限额 —— 我改不了(要后台凭据 + DNS)。

## 六、Supabase 邮件限流治本:Resend 步骤(owner 操作)

标准做法(几乎所有生产 Supabase 项目都这么干):**默认内置邮件服务只能 ~2-4 封/小时、
官方明说"不可用于生产",必须换成自己的 SMTP。** 首选 Resend(和 Supabase 集成最顺)。

1. Resend 注册 → 加域名 `pinzos.com`(建议用子域 `send.pinzos.com` 发信,不污染主域信誉)。
2. 按 Resend 给的记录在 Cloudflare 加 **SPF + DKIM + DMARC**(3 条 DNS)—— 决定验证码进不进垃圾箱,必配。
3. Supabase Dashboard → Authentication → Emails → **SMTP Settings** → 填 Resend 的
   host `smtp.resend.com` / port 465 / user `resend` / pass = Resend API key;发件人用
   `no-reply@send.pinzos.com`。
4. Supabase → Authentication → **Rate Limits** → 把 "Emails per hour" 从默认(接了自建 SMTP 后
   默认 30/h)调高到够用(如 100-200/h);单邮箱 60s 间隔保留(前端冷却已对齐)。
5. 发一封测试验证码确认到达 + 不进垃圾箱。

成本:Resend 免费档 3000 封/月、100 封/天;登录验证码这点量**免费档绰绰有余**。
