/**
 * 认证勋章 — 购买套餐后颁发,按生效订阅推导(不落新表)。
 * 设计稿: docs/role-onboarding-badges-plan-2026-07-05.md
 * 展示:UserMenu 常显 + 「我的勋章」弹窗可生成发朋友圈的分享图(canvas)。
 */
import QRCode from 'qrcode'

export interface RoleBadge {
  planId: string
  titleZh: string
  titleEn: string
  /** 证书专属英文头衔(逐档更高级;与短 chip 用的 titleEn 分开)。 */
  certTitle: string
  subZh: string
  subEn: string
  emoji: string
  /** 分享卡渐变(深色,朋友圈里显质感) */
  from: string
  to: string
  accent: string
}

const BADGES: Record<string, RoleBadge> = {
  rookie: {
    planId: 'rookie', emoji: '💼',
    titleZh: '认证经纪人', titleEn: 'Certified Agent',
    certTitle: 'Certified Property Agent',
    subZh: 'PINZOS 认证 · 启程', subEn: 'PINZOS Certified · Starter',
    from: '#0f2b5b', to: '#1e40af', accent: '#60a5fa',
  },
  agent: {
    planId: 'agent', emoji: '🏅',
    titleZh: '金牌经纪人 PRO', titleEn: 'Pro Agent',
    certTitle: 'Senior Certified Advisor',
    subZh: 'PINZOS 认证 · 专业版', subEn: 'PINZOS Certified · Pro',
    from: '#1e1b4b', to: '#4338ca', accent: '#fbbf24',
  },
  founder: {
    planId: 'founder', emoji: '🏢',
    titleZh: '认证经纪公司', titleEn: 'Certified Agency',
    certTitle: 'Accredited Brokerage Partner',
    subZh: 'PINZOS 认证 · 经纪公司', subEn: 'PINZOS Certified · Agency',
    from: '#2e1065', to: '#7c3aed', accent: '#e9d5ff',
  },
  developer: {
    planId: 'developer', emoji: '🏗️',
    titleZh: '认证开发商', titleEn: 'Certified Developer',
    certTitle: 'Accredited Development Partner',
    subZh: 'PINZOS 认证 · 开发商', subEn: 'PINZOS Certified · Developer',
    from: '#451a03', to: '#d97706', accent: '#fde68a',
  },
}

/** 套餐 → 角色(付费才定身份的唯一映射;席位成员按 agent 算) */
export const ROLE_BY_PLAN: Record<string, 'agent' | 'agency' | 'developer'> = {
  rookie: 'agent', agent: 'agent', founder: 'agency', developer: 'developer',
}

/** 生效订阅(active/trialing)→ 勋章;无订阅/免费档 → null。
 *  teamMember=true(被邀请进团队的成员)→ 按「认证经纪人」发,不给公司勋章。 */
export function badgeForPlan(planId: string | undefined | null, status?: string | null, teamMember?: boolean): RoleBadge | null {
  if (!planId) return null
  if (status && !['active', 'trialing'].includes(status)) return null
  if (teamMember) return MEMBER_BADGES[planId] || MEMBER_BADGES.founder
  return BADGES[planId] || null
}

/** 团队成员勋章:按团队套餐发(经纪公司团队=经纪人;开发商团队=开发商成员) */
const MEMBER_BADGES: Record<string, RoleBadge> = {
  founder: {
    planId: 'member', emoji: '💼',
    titleZh: '认证经纪人', titleEn: 'Certified Agent',
    certTitle: 'Certified Property Agent',
    subZh: 'PINZOS 认证 · 团队成员', subEn: 'PINZOS Certified · Team member',
    from: '#0f2b5b', to: '#1e40af', accent: '#60a5fa',
  },
  developer: {
    planId: 'member', emoji: '🏗️',
    titleZh: '认证开发商', titleEn: 'Certified Developer',
    certTitle: 'Accredited Development Partner',
    subZh: 'PINZOS 认证 · 团队成员', subEn: 'PINZOS Certified · Team member',
    from: '#451a03', to: '#d97706', accent: '#fde68a',
  },
}

// ── 证书配色(navy + gold on ivory —— 官方、可信;非山寨金卡)──────
const NAVY = '#1C2B4A'   // 深藏青(机构名/人名/日期/编号)
const GOLD = '#B08A3C'   // 沉稳金(称号/印章/边线)
const SERIF = 'Georgia, "Times New Roman", "PingFang SC", "Microsoft YaHei", serif'
const SANS = '"Helvetica Neue", Arial, "PingFang SC", system-ui, sans-serif'
const MONTHS_EN = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December']

/** 稳定的凭证编号(按持有人 + 档位派生,不随每次生成变化)。 */
function certNumber(seed: string): string {
  let h = 0
  for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) >>> 0
  return String(h % 1000000).padStart(6, '0')
}

/** 字间距(canvas 无原生 letter-spacing,用细空格近似拉开)。 */
function spread(s: string, n: number): string {
  return s.split('').join(String.fromCharCode(0x2009).repeat(Math.max(1, n)))
}

/** 居中自动换行(按词),返回行数。 */
function wrapCentered(ctx: CanvasRenderingContext2D, text: string, cx: number, y: number, maxW: number, lh: number): number {
  const lines: string[] = []
  let cur = ''
  for (const t of text.split(' ')) {
    const trial = cur ? cur + ' ' + t : t
    if (ctx.measureText(trial).width > maxW && cur) { lines.push(cur); cur = t } else cur = trial
  }
  if (cur) lines.push(cur)
  lines.forEach((ln, i) => ctx.fillText(ln, cx, y + i * lh))
  return lines.length
}

/** 五角星路径填充。 */
function star(ctx: CanvasRenderingContext2D, cx: number, cy: number, r: number, fill: string | CanvasGradient) {
  ctx.beginPath()
  for (let i = 0; i < 10; i++) {
    const a = -Math.PI / 2 + (i * Math.PI) / 5
    const rad = i % 2 === 0 ? r : r * 0.42
    const x = cx + Math.cos(a) * rad, y = cy + Math.sin(a) * rad
    i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y)
  }
  ctx.closePath(); ctx.fillStyle = fill; ctx.fill()
}

/** 烫金渐变(上亮下暗,模拟金箔层次,去平涂廉价感)。 */
function goldGrad(ctx: CanvasRenderingContext2D, y0: number, y1: number): CanvasGradient {
  const g = ctx.createLinearGradient(0, y0, 0, y1)
  g.addColorStop(0, '#E7CE84'); g.addColorStop(0.48, '#C39C4C'); g.addColorStop(1, '#987328')
  return g
}

/** 正多边形路径(不描边不填充,只建路径)。 */
function polyPath(ctx: CanvasRenderingContext2D, cx: number, cy: number, r: number, n: number, rot: number) {
  ctx.beginPath()
  for (let i = 0; i < n; i++) {
    const a = rot + (i * 2 * Math.PI) / n
    const x = cx + Math.cos(a) * r, y = cy + Math.sin(a) * r
    i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y)
  }
  ctx.closePath()
}

/**
 * khatam 八芒星(伊斯兰几何 najma):两个正方形叠加旋转 45° + 外圆 + 内八边形。
 * 纯线稿、完全对称 —— 优雅的迪拜/阿拉伯识别符号,替代之前杂乱的棕榈叶。
 */
function khatam(ctx: CanvasRenderingContext2D, cx: number, cy: number, r: number, stroke: string | CanvasGradient, lw: number, alpha: number) {
  ctx.save(); ctx.globalAlpha = alpha; ctx.strokeStyle = stroke; ctx.lineWidth = lw; ctx.lineJoin = 'miter'
  polyPath(ctx, cx, cy, r, 4, -Math.PI / 2); ctx.stroke()
  polyPath(ctx, cx, cy, r, 4, -Math.PI / 4); ctx.stroke()
  ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2); ctx.stroke()
  polyPath(ctx, cx, cy, r * 0.55, 8, Math.PI / 8); ctx.stroke()
  ctx.restore()
}

/** 顶部 P 字母徽章:烫金双环 + 8 向刻度 + 衬线 P(呼应 wordmark,bespoke 而非 clip-art)。 */
function monogram(ctx: CanvasRenderingContext2D, cx: number, cy: number, r: number) {
  const gg = goldGrad(ctx, cy - r, cy + r)
  ctx.strokeStyle = gg; ctx.fillStyle = gg
  ctx.lineWidth = 1.6; ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2); ctx.stroke()
  ctx.lineWidth = 0.9; ctx.beginPath(); ctx.arc(cx, cy, r - 5, 0, Math.PI * 2); ctx.stroke()
  // 8 向刻度:用实金(非渐变)确保 8 根完全一致
  ctx.strokeStyle = GOLD; ctx.lineWidth = 1.4
  for (let i = 0; i < 8; i++) {
    const a = i * Math.PI / 4
    ctx.beginPath()
    ctx.moveTo(cx + Math.cos(a) * (r + 3), cy + Math.sin(a) * (r + 3))
    ctx.lineTo(cx + Math.cos(a) * (r + 9), cy + Math.sin(a) * (r + 9)); ctx.stroke()
  }
  // P 视觉下移(bowl 重心偏上,补 ~4px 让它在环里居中)
  ctx.fillStyle = gg
  ctx.font = `700 ${r * 1.02}px ${SERIF}`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'
  ctx.fillText('P', cx, cy + r * 0.16); ctx.textBaseline = 'alphabetic'
}

/** 底部 khatam 印章(简版:八边形 + 一个方 + 中心星,小尺寸更干净)。 */
function khatamSeal(ctx: CanvasRenderingContext2D, cx: number, cy: number, r: number) {
  const gg = goldGrad(ctx, cy - r, cy + r)
  ctx.fillStyle = 'rgba(176,138,60,0.05)'
  ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2); ctx.fill()
  ctx.save(); ctx.strokeStyle = gg; ctx.lineWidth = 1.6; ctx.lineJoin = 'miter'
  polyPath(ctx, cx, cy, r, 8, Math.PI / 8); ctx.stroke()          // 八边形
  polyPath(ctx, cx, cy, r * 0.82, 4, -Math.PI / 4); ctx.stroke()  // 内嵌一个方(菱形)
  ctx.restore()
  star(ctx, cx, cy, r * 0.3, gg)                                   // 中心星
}

/** 四角内嵌阶梯角饰 + 小菱形(mitered keystone;用实金,四角完全对称)。 */
function cornerOrn(ctx: CanvasRenderingContext2D, x: number, y: number, sx: number, sy: number) {
  ctx.strokeStyle = GOLD; ctx.lineWidth = 1.4; ctx.lineJoin = 'miter'
  ctx.beginPath()
  ctx.moveTo(x + sx * 8, y + sy * 36)
  ctx.lineTo(x + sx * 8, y + sy * 18)
  ctx.lineTo(x + sx * 18, y + sy * 18)
  ctx.lineTo(x + sx * 18, y + sy * 8)
  ctx.lineTo(x + sx * 36, y + sy * 8)
  ctx.stroke()
  ctx.fillStyle = GOLD
  ctx.save(); ctx.translate(x + sx * 21, y + sy * 21); ctx.rotate(Math.PI / 4); ctx.fillRect(-3, -3, 6, 6); ctx.restore()
}

/** 画一个真实可扫的二维码(navy on 浅底,链接到公开验证页)。 */
async function drawQR(ctx: CanvasRenderingContext2D, url: string, x: number, y: number, size: number): Promise<boolean> {
  try {
    const durl = await QRCode.toDataURL(url, { margin: 1, width: size * 3, color: { dark: '#1C2B4A', light: '#FAF6EC' } })
    const img = await new Promise<HTMLImageElement | null>((res) => {
      const i = new Image(); i.onload = () => res(i); i.onerror = () => res(null); i.src = durl
    })
    if (!img) return false
    ctx.drawImage(img, x, y, size, size)
    return true
  } catch { return false }
}

/** 微暖白安全纸:细纤维 + 轻暗角(khatam 水印在 drawCertificate 里精确定位)。 */
function paper(ctx: CanvasRenderingContext2D, W: number, H: number) {
  const g = ctx.createLinearGradient(0, 0, 0, H)
  g.addColorStop(0, '#FCFAF4'); g.addColorStop(1, '#F3ECDC')
  ctx.fillStyle = g; ctx.fillRect(0, 0, W, H)
  for (let i = 0; i < 2400; i++) {
    const x = Math.random() * W, y = Math.random() * H, a = Math.random() * Math.PI, len = 2 + Math.random() * 6
    ctx.strokeStyle = Math.random() > 0.5 ? 'rgba(120,100,60,0.03)' : 'rgba(255,252,244,0.05)'
    ctx.lineWidth = 1
    ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x + Math.cos(a) * len, y + Math.sin(a) * len); ctx.stroke()
  }
  const v = ctx.createRadialGradient(W / 2, H / 2, H * 0.42, W / 2, H / 2, H * 0.92)
  v.addColorStop(0, 'rgba(0,0,0,0)'); v.addColorStop(1, 'rgba(80,64,36,0.11)')
  ctx.fillStyle = v; ctx.fillRect(0, 0, W, H)
}

/**
 * 画一张横版专业认证证书(1600×1130,始终英文)。
 * 现代数字凭证(AWS/Credly)可信做法:机构标识 + 姓名/称号衬线主视觉 + 唯一凭证编号
 * + 「Verify at …」验证链接(取代不可信手写签名)。navy+烫金渐变 + guilloche 安全底纹。
 */
export async function drawCertificate(
  canvas: HTMLCanvasElement,
  badge: RoleBadge,
  opts: { name: string; zh?: boolean; photoUrl?: string | null; dateStr?: string; credentialId?: string }
): Promise<void> {
  const W = 1600, H = 1130
  canvas.width = W; canvas.height = H
  const ctx = canvas.getContext('2d')
  if (!ctx) return
  const name = opts.name
  const cx = W / 2
  const WARM = '#6B6459'   // 暖灰正文(替代冷灰,贴金/象牙调)

  paper(ctx, W, H)

  // 中心 khatam 八芒星水印(唯一底纹,极淡对称,迪拜识别;垂直居中于构图光学中线)
  khatam(ctx, cx, 560, 268, GOLD, 1, 0.05)

  // 边框:分层双线(外实内淡)+ 四角 mitered 角饰
  ctx.strokeStyle = goldGrad(ctx, 40, H - 40); ctx.lineWidth = 1.6; ctx.strokeRect(46, 46, W - 92, H - 92)
  ctx.save(); ctx.globalAlpha = 0.5; ctx.strokeStyle = GOLD; ctx.lineWidth = 0.8; ctx.strokeRect(58, 58, W - 116, H - 116); ctx.restore()
  cornerOrn(ctx, 66, 66, 1, 1); cornerOrn(ctx, W - 66, 66, -1, 1)
  cornerOrn(ctx, 66, H - 66, 1, -1); cornerOrn(ctx, W - 66, H - 66, -1, -1)

  ctx.textAlign = 'center'

  // 顶部 P 字母徽章
  monogram(ctx, cx, 134, 44)

  // 机构标识(masthead)
  ctx.fillStyle = NAVY
  ctx.font = `700 70px ${SERIF}`
  ctx.fillText(spread('PINZOS', 6), cx, 250)
  ctx.fillStyle = goldGrad(ctx, 272, 296)
  ctx.font = `600 22px ${SANS}`
  ctx.fillText(spread('DUBAI REAL ESTATE CERTIFICATION', 3), cx, 292)
  ctx.strokeStyle = goldGrad(ctx, 316, 320); ctx.lineWidth = 1.5
  ctx.beginPath(); ctx.moveTo(cx - 70, 318); ctx.lineTo(cx + 70, 318); ctx.stroke()

  // 引导语
  ctx.fillStyle = WARM
  ctx.font = `600 21px ${SANS}`
  ctx.fillText(spread('THIS CERTIFICATE IS PROUDLY PRESENTED TO', 2), cx, 394)

  // 姓名(hero,更大;过长自动缩)+ 贴近的烫金下划线
  ctx.fillStyle = NAVY
  let ns = 96
  ctx.font = `700 ${ns}px ${SERIF}`
  while (ctx.measureText(name).width > W - 560 && ns > 44) { ns -= 4; ctx.font = `700 ${ns}px ${SERIF}` }
  ctx.fillText(name, cx, 486)
  const uw = Math.min(W - 620, ctx.measureText(name).width + 90)   // ~110% 名宽,居中不左偏
  ctx.strokeStyle = goldGrad(ctx, 512, 516); ctx.lineWidth = 1.5
  ctx.beginPath(); ctx.moveTo(cx - uw / 2, 514); ctx.lineTo(cx + uw / 2, 514); ctx.stroke()

  // 引语
  ctx.fillStyle = WARM
  ctx.font = `italic 400 26px ${SERIF}`
  ctx.fillText('in recognition of attaining the professional designation of', cx, 574)

  // 称号「plaque」:上下各一条烫金细线夹住,读作正式头衔而非正文
  const title = spread((badge.certTitle || 'Certified Agent').toUpperCase(), 1)
  let ts = 46
  ctx.font = `700 ${ts}px ${SERIF}`
  while (ctx.measureText(title).width > W - 500 && ts > 28) { ts -= 2; ctx.font = `700 ${ts}px ${SERIF}` }
  const tw = ctx.measureText(title).width
  const rw = Math.min(W - 460, tw + 130)
  ctx.strokeStyle = goldGrad(ctx, 610, 614); ctx.lineWidth = 1
  ctx.beginPath(); ctx.moveTo(cx - rw / 2, 612); ctx.lineTo(cx + rw / 2, 612); ctx.stroke()
  ctx.fillStyle = goldGrad(ctx, 646 - ts, 656)
  ctx.fillText(title, cx, 656)
  ctx.strokeStyle = goldGrad(ctx, 682, 686); ctx.lineWidth = 1
  ctx.beginPath(); ctx.moveTo(cx - rw / 2, 684); ctx.lineTo(cx + rw / 2, 684); ctx.stroke()

  // 一句正文(暖灰,略小,后退)
  ctx.fillStyle = WARM
  ctx.font = `400 19px ${SANS}`
  wrapCentered(ctx, 'Verified for professional standing on Pinzos, Dubai’s modern off-plan real-estate platform.', cx, 728, W - 320, 28)

  // 分隔节点:40% 宽烫金细线 + 中心小菱形(把中部空档收成有意的呼吸区)
  const dy = 800
  ctx.strokeStyle = goldGrad(ctx, dy - 2, dy + 2); ctx.lineWidth = 1
  ctx.beginPath(); ctx.moveTo(cx - 300, dy); ctx.lineTo(cx - 14, dy); ctx.stroke()
  ctx.beginPath(); ctx.moveTo(cx + 14, dy); ctx.lineTo(cx + 300, dy); ctx.stroke()
  ctx.fillStyle = goldGrad(ctx, dy - 7, dy + 7)
  ctx.save(); ctx.translate(cx, dy); ctx.rotate(Math.PI / 4); ctx.fillRect(-6, -6, 12, 12); ctx.restore()

  // 日期 / 编号
  const d = new Date()
  const y4 = opts.dateStr ? opts.dateStr.slice(0, 4) : String(d.getFullYear())
  const mi = opts.dateStr ? Number(opts.dateStr.slice(5, 7)) - 1 : d.getMonth()
  const dateDisp = `${MONTHS_EN[mi] || ''} ${y4}`
  const credentialId = opts.credentialId || `PZ-${y4}-${certNumber(`${name}|${badge.planId}`)}`

  // 底部三栏(共用一行:垂直中心对齐 ~y924,标签统一 tracking)
  // 中:khatam 印章 + CERTIFIED
  khatamSeal(ctx, cx, 922, 52)
  ctx.textAlign = 'center'
  ctx.fillStyle = goldGrad(ctx, 982, 996); ctx.font = `600 13px ${SANS}`
  ctx.fillText(spread('CERTIFIED', 2), cx, 992)

  // 左:发证日期
  const lx = 300
  ctx.fillStyle = goldGrad(ctx, 894, 910); ctx.font = `600 13px ${SANS}`
  ctx.fillText(spread('DATE OF ISSUE', 2), lx, 906)
  ctx.fillStyle = NAVY; ctx.font = `italic 400 30px ${SERIF}`
  ctx.fillText(dateDisp, lx, 950)

  // 右:真实二维码(扫码到公开验证页)+ 凭证编号
  const rx = W - 300
  const origin = (typeof window !== 'undefined' && window.location?.origin) || 'https://pinzos.com'
  const verifyUrl = `${origin}/verify/${credentialId}`
  const qrSize = 104
  const ok = await drawQR(ctx, verifyUrl, rx - qrSize / 2, 850, qrSize)
  ctx.textAlign = 'center'
  ctx.fillStyle = NAVY; ctx.font = `700 21px ${SERIF}`
  ctx.fillText(credentialId, rx, 978)
  ctx.fillStyle = WARM; ctx.font = `400 14px ${SANS}`
  ctx.fillText(ok ? 'Scan to verify · pinzos.com/verify' : 'Verify at pinzos.com/verify', rx, 1000)
}
