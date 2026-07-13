/**
 * 内置浏览器(WebView)识别。
 *
 * 微信的 WebView 会拦截跳往外部域的 OAuth 跳转(accounts.google.com、*.supabase.co),
 * 用户点了 "Continue with Google" 只会看到一个白屏或"已停止访问该网页" —— 在微信里这个
 * 按钮**永远不可能成功**。客户大量从微信里点分享链接进来(经纪把 tour / 报价单发群里),
 * 所以这不是边角场景。识别出来之后只给邮箱验证码登录,那条路在 WebView 里是通的。
 */
export function isWeChatBrowser(): boolean {
  if (typeof navigator === 'undefined') return false
  // wxwork = 企业微信,同一套 WebView 限制
  return /micromessenger|wxwork/i.test(navigator.userAgent)
}
