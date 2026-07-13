# 登录体验崩坏：三个根因与修复

日期：2026-07-12
触发：owner 报「登录完还是显示没登录」「几个 tab 状态不一样」「微信里 Google 登录必失败」

---

## TL;DR

三个症状，三个**互相独立**的根因，全部定位到具体代码行并已修复验证：

| 症状 | 根因 | 修复 |
|---|---|---|
| 登录完显示没登录 | `navigator.locks` 是 origin 级共享锁，别的 tab（尤其冻结的后台 tab）占死它，gotrue 等 10s 后 `abort()` → 抛 `signal is aborted without reason` | 自定义 `lock`：抢不到锁就**降级为无锁执行**，不再让用户登录失败 |
| 每天都要重登 / 跨设备被踢 | `supabase.auth.signOut()` **默认 `scope: 'global'`**，一处退出吊销**所有设备**的 refresh token | `signOut({ scope: 'local' })` |
| 几个 tab 状态不一样 | auth-js 不监听 `storage` 事件，A tab 登录/退出后 B tab 内存里还是旧 session | AuthContext 加 `storage` 事件监听，跨 tab 拉齐 session |
| 微信里 Google 登录失败 | 微信 WebView 拦截跳往 `accounts.google.com` / `*.supabase.co` 的外部跳转；代码里**零 UA 检测** | 识别 `MicroMessenger`/`wxwork` → 隐藏 Google/Microsoft，只留邮箱验证码 + 指引 |

---

## 根因一：navigator.locks 把用户挡在门外

### 证据链

线上 `app_events` 里 14 条 `auth_failure`，**全部是同一条**：

```json
{
  "path": "/auth/callback",
  "provider": "google",
  "reason": "exception",
  "message": "signal is aborted without reason",
  "has_hash": true,
  "has_code": false,
  "storage_ok": true
}
```

`has_hash:true / has_code:false` → 走的是 implicit flow，token 在 URL hash 里，
`AuthCallback` 调 `setSession()` 消费它。

### 机制

auth-js 用 `navigator.locks` 串行化所有 auth 操作，锁名按 `storageKey` 派生
（`lock:pinzos-auth`）。关键事实：

1. **这把锁是整个 origin 共享的** —— 不是 per-tab。
2. auth-js 默认 `lockAcquireTimeout: 10000`（`GoTrueClient.js:25`）。
3. 超时走 `navigatorLock`（`lib/locks.js`）里的 `abortController.abort()` —— **不带 reason**。
4. 浏览器抛出的 DOMException 消息就是字面量 **`"signal is aborted without reason"`**。

所以：任何一个 tab（**包括被浏览器冻结、永远不会释放锁的后台 tab**）攥着这把锁，
登录 tab 的 `setSession()` 就抢不到 → 等 10 秒 → abort → 失败。
`AuthCallback` 的 `abortRetry` 还会再重试 5 次、每次又等 10 秒，
用户看到的就是"转很久的圈，然后说登录失败"。

owner 习惯开很多 tab → 命中率极高，完全对得上「经常登录就失败」。

### 修复

`frontend/src/lib/supabase.ts` 传入自定义 `lock`：

- 等锁封顶 **5 秒**（而不是 10 秒）
- **抢不到锁就不加锁直接执行** —— 为了一把跨 tab 互斥锁而把用户挡在门外，这个取舍是反的
- 严格区分「没抢到锁」和「抢到了但操作自己失败了」，后者绝不重跑
- `acquireTimeout === 0`（自动刷新 tick 的「抢不到就算了」语义）保持原样

**代价**：最坏情况两个 tab 同时刷新 token。Supabase 有 10s 的 refresh token 复用宽限期
（窗口内同一个旧 token 会拿到同一个新 token），代价远小于登不进去。

### 验证（真 Chromium）

模拟「冻结的后台 tab 永久占锁」，再看 app 认不认 localStorage 里的登录态：

```
修复后：识别出登录态 = 是   (5298ms)   abort 报错 0 条   → PASS
撤掉修复：识别出登录态 = 否 (20704ms)  abort 报错 6 条：
          AbortError: signal is aborted without reason   ← 与线上埋点一字不差
```

同一个测试能抓到 bug、也能证明修好了。

---

## 根因二：signOut 默认 global，一处退出踢掉所有设备

### 证据链

`auth_signed_out` 埋点里 `manual:false` 的（= SDK 自己干掉 session，不是用户点的）
是原先怀疑的「refresh token reuse-detection 悬案」。查它们和**手动退出**的时间差：

```
23:52:18.814  manual:true   Windows  /admin/analytics   ← 你点了退出
23:52:22.756  manual:false  Mac      /admin/analytics   ← 3.9 秒后被踢
23:52:22.758  manual:false  iPhone   /map               ← 3.9 秒后被踢
```

**20 次自动登出里，14 次发生在另一台设备手动退出后的 3.9 ~ 11.5 秒内。**

不是 reuse detection。是 `supabase.auth.signOut()` 的**默认 `scope: 'global'`**：
它会吊销该账号在**所有设备**上的 refresh token。

### 修复

`AuthContext.signOut()` → `supabase.auth.signOut({ scope: 'local' })`。

### 遗留

还有 6 次 `manual:false` 的登出**没有**手动退出前置（间隔 1900s ~ 23000s）。
这部分尚未解释，可能是长时间挂机后的刷新失败。已知缺口：
**`TOKEN_REFRESHED` 事件目前完全没埋点**，刷新成功/失败是黑洞。建议下一步补上。

---

## 根因三：零跨 tab 同步

auth-js **不监听 `storage` 事件**（只在 `visibilitychange` 时和存储对账）。
并排开着的两个 tab，A 登录/退出/换账号后，B 的内存里还是旧 session，界面一直显示错的人。

埋点里也能看到串账号的痕迹：`user_email=lzp6529@gmail.com` 但
`last_email=admin@yesir.ai` / `realtorgptapp@gmail.com`。

而且 `signOut` 改成 `scope:'local'` 后**更需要**这条链路：
本地退出只清存储，清不掉其它 tab 内存里的 session。

### 修复

`AuthContext` 监听 `storage` 事件（key = `pinzos-auth`）：

- 存储里 session 没了 → 别的 tab 退出了 → 本 tab 也 `signOut({scope:'local'})`
- 存储里的 access_token 变了 → 别的 tab 登录/换账号/刷新了 token → `setSession()` 采用它

验证：两个 tab 都登录 → A tab 清掉 session → B tab 跟着变成未登录。PASS。

---

## 根因四：微信 WebView 里 Google 登录必然失败

微信内置浏览器会拦截跳往外部域的 OAuth 跳转（`accounts.google.com`、`*.supabase.co`），
用户点了 "Continue with Google" 只会看到白屏或"已停止访问该网页"。

而代码里**一处 UA 检测都没有**（全仓 `MicroMessenger` 零命中），
尽管 `llms.txt` 明说客户「在手机或微信里零安装打开链接」是主场景 —— 经纪把 tour /
报价单发到群里，客户就是从微信点进来的。

### 修复

新增 `frontend/src/lib/browser.ts` → `isWeChatBrowser()`（`MicroMessenger` / `wxwork`）。

- `LoginPage`：隐藏 Google 按钮，换成黄色提示「微信内无法使用 Google 登录，请用上面的
  邮箱验证码登录。也可点右上角「⋯」选择「在浏览器中打开」。」
- `LoginDialog`：Tab 从 3 列收成 1 列（只留 Email），邮箱步骤下方给同一条提示

验证：微信 UA → Google 按钮不存在、提示在、邮箱输入框可用；普通浏览器 UA → Google 按钮照常在。

---

## 改动文件

| 文件 | 改动 |
|---|---|
| `frontend/src/lib/supabase.ts` | 自定义 `resilientLock`；导出 `AUTH_STORAGE_KEY` |
| `frontend/src/lib/browser.ts` | **新增** `isWeChatBrowser()` |
| `frontend/src/contexts/AuthContext.tsx` | `signOut({scope:'local'})`；`storage` 事件跨 tab 同步 |
| `frontend/src/pages/LoginPage.tsx` | 微信内隐藏 Google，给提示 |
| `frontend/src/components/auth/LoginDialog.tsx` | 微信内只留 Email tab |
| `frontend/src/i18n/locales/{en,zh-CN}/auth.json` | `wechatNoGoogle` 文案 |

---

## 建议的下一步

1. **给 `TOKEN_REFRESHED` 埋点** —— 剩下 6 次无法解释的自动登出，缺的就是这段数据。
2. **401 目前不进错误监控**（`errorCapture.ts:13` 明确排除）。如果刷新失败后前端继续拿旧
   token 打接口，会产生一串 401，但这些在 dashboard 上完全隐形。至少该采样上报。
3. 观察 `auth_failure` 是否归零 —— 这是本次修复最直接的验收指标。
