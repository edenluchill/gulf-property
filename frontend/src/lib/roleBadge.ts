/**
 * 认证勋章 — 购买套餐后颁发,按生效订阅推导(不落新表)。
 * 设计稿: docs/role-onboarding-badges-plan-2026-07-05.md
 * 展示:UserMenu 常显 + 「我的勋章」弹窗可生成发朋友圈的分享图(canvas)。
 */

export interface RoleBadge {
  planId: string
  titleZh: string
  titleEn: string
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
    subZh: 'PINZOS 认证 · 启程', subEn: 'PINZOS Certified · Starter',
    from: '#0f2b5b', to: '#1e40af', accent: '#60a5fa',
  },
  agent: {
    planId: 'agent', emoji: '🏅',
    titleZh: '金牌经纪人 PRO', titleEn: 'Pro Agent',
    subZh: 'PINZOS 认证 · 专业版', subEn: 'PINZOS Certified · Pro',
    from: '#1e1b4b', to: '#4338ca', accent: '#fbbf24',
  },
  founder: {
    planId: 'founder', emoji: '🏢',
    titleZh: '认证经纪公司', titleEn: 'Certified Agency',
    subZh: 'PINZOS 认证 · 经纪公司', subEn: 'PINZOS Certified · Agency',
    from: '#2e1065', to: '#7c3aed', accent: '#e9d5ff',
  },
  developer: {
    planId: 'developer', emoji: '🏗️',
    titleZh: '认证开发商', titleEn: 'Certified Developer',
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
    subZh: 'PINZOS 认证 · 团队成员', subEn: 'PINZOS Certified · Team member',
    from: '#0f2b5b', to: '#1e40af', accent: '#60a5fa',
  },
  developer: {
    planId: 'member', emoji: '🏗️',
    titleZh: '认证开发商', titleEn: 'Certified Developer',
    subZh: 'PINZOS 认证 · 团队成员', subEn: 'PINZOS Certified · Team member',
    from: '#451a03', to: '#d97706', accent: '#fde68a',
  },
}

// ── 证书配色(navy + gold on ivory —— 官方、可信;非山寨金卡)──────
const NAVY = '#1C2B4A'   // 深藏青(机构名/人名/日期/编号)
const GOLD = '#B08A3C'   // 沉稳金(称号/印章/边线)
const MUTE = '#7A7469'   // 灰褐(次要文字)
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

/** 五角星。 */
function star(ctx: CanvasRenderingContext2D, cx: number, cy: number, r: number, color: string) {
  ctx.beginPath()
  for (let i = 0; i < 10; i++) {
    const a = -Math.PI / 2 + (i * Math.PI) / 5
    const rad = i % 2 === 0 ? r : r * 0.42
    const x = cx + Math.cos(a) * rad, y = cy + Math.sin(a) * rad
    i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y)
  }
  ctx.closePath(); ctx.fillStyle = color; ctx.fill()
}

/** 干净的金色认证徽章(双环 + 币缘点 + 星 + CERTIFIED / PINZOS);非卡通蜡印。 */
function sealMedal(ctx: CanvasRenderingContext2D, cx: number, cy: number, r: number) {
  ctx.fillStyle = 'rgba(176,138,60,0.05)'
  ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2); ctx.fill()
  ctx.strokeStyle = GOLD; ctx.lineWidth = 2.5
  ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2); ctx.stroke()
  ctx.lineWidth = 1
  ctx.beginPath(); ctx.arc(cx, cy, r * 0.82, 0, Math.PI * 2); ctx.stroke()
  ctx.fillStyle = GOLD
  const dots = 48
  for (let i = 0; i < dots; i++) {
    const a = (2 * Math.PI * i) / dots
    ctx.beginPath(); ctx.arc(cx + Math.cos(a) * r * 0.91, cy + Math.sin(a) * r * 0.91, 1.5, 0, Math.PI * 2); ctx.fill()
  }
  star(ctx, cx, cy - r * 0.26, r * 0.2, GOLD)
  ctx.textAlign = 'center'
  ctx.fillStyle = NAVY
  ctx.font = `700 ${Math.round(r * 0.19)}px ${SANS}`
  ctx.fillText(spread('CERTIFIED', 2), cx, cy + r * 0.14)
  ctx.fillStyle = GOLD
  ctx.font = `600 ${Math.round(r * 0.14)}px ${SANS}`
  ctx.fillText(spread('PINZOS', 2), cx, cy + r * 0.46)
}

/** 微暖白安全纸:细纤维 + 中心隐纹同心圆 + 轻暗角。 */
function paper(ctx: CanvasRenderingContext2D, W: number, H: number) {
  const g = ctx.createLinearGradient(0, 0, 0, H)
  g.addColorStop(0, '#FCFAF4'); g.addColorStop(1, '#F4EEE0')
  ctx.fillStyle = g; ctx.fillRect(0, 0, W, H)
  for (let i = 0; i < 2600; i++) {
    const x = Math.random() * W, y = Math.random() * H, a = Math.random() * Math.PI, len = 2 + Math.random() * 6
    ctx.strokeStyle = Math.random() > 0.5 ? 'rgba(120,100,60,0.035)' : 'rgba(255,252,244,0.05)'
    ctx.lineWidth = 1
    ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x + Math.cos(a) * len, y + Math.sin(a) * len); ctx.stroke()
  }
  ctx.strokeStyle = 'rgba(176,138,60,0.045)'; ctx.lineWidth = 1
  for (let rr = 70; rr < 430; rr += 15) { ctx.beginPath(); ctx.arc(W / 2, H * 0.5, rr, 0, Math.PI * 2); ctx.stroke() }
  const v = ctx.createRadialGradient(W / 2, H / 2, H * 0.42, W / 2, H / 2, H * 0.9)
  v.addColorStop(0, 'rgba(0,0,0,0)'); v.addColorStop(1, 'rgba(80,64,36,0.10)')
  ctx.fillStyle = v; ctx.fillRect(0, 0, W, H)
}

/**
 * 画一张横版专业认证证书(1600×1130,始终英文)。
 * 参考现代数字凭证(AWS/Credly)的可信做法:机构标识居中 + 姓名/称号衬线主视觉
 * + 唯一凭证编号 + 「Verify at …」验证链接 取代不可信的手写签名。navy+gold 官方配色。
 */
export async function drawCertificate(
  canvas: HTMLCanvasElement,
  badge: RoleBadge,
  opts: { name: string; zh?: boolean; photoUrl?: string | null; dateStr?: string }
): Promise<void> {
  const W = 1600, H = 1130
  canvas.width = W; canvas.height = H
  const ctx = canvas.getContext('2d')
  if (!ctx) return
  const name = opts.name
  const cx = W / 2

  paper(ctx, W, H)

  // 边框:金色双细线 + 四角小菱形
  ctx.strokeStyle = GOLD
  ctx.lineWidth = 2.5; ctx.strokeRect(46, 46, W - 92, H - 92)
  ctx.lineWidth = 1; ctx.strokeRect(58, 58, W - 116, H - 116)
  ctx.fillStyle = GOLD
  for (const [x, y] of [[58, 58], [W - 58, 58], [58, H - 58], [W - 58, H - 58]]) {
    ctx.save(); ctx.translate(x, y); ctx.rotate(Math.PI / 4); ctx.fillRect(-6, -6, 12, 12); ctx.restore()
  }
  ctx.textAlign = 'center'

  // 机构标识(masthead)
  ctx.fillStyle = NAVY
  ctx.font = `700 72px ${SERIF}`
  ctx.fillText(spread('PINZOS', 6), cx, 158)
  ctx.fillStyle = GOLD
  ctx.font = `600 22px ${SANS}`
  ctx.fillText(spread('DUBAI REAL ESTATE CERTIFICATION', 3), cx, 200)
  ctx.strokeStyle = GOLD; ctx.lineWidth = 1.5
  ctx.beginPath(); ctx.moveTo(cx - 70, 228); ctx.lineTo(cx + 70, 228); ctx.stroke()

  // 引导语
  ctx.fillStyle = MUTE
  ctx.font = `600 22px ${SANS}`
  ctx.fillText(spread('THIS CERTIFICATE IS PROUDLY PRESENTED TO', 2), cx, 312)

  // 姓名(衬线主视觉,过长自动缩)+ 金色下划线
  ctx.fillStyle = NAVY
  let ns = 84
  ctx.font = `700 ${ns}px ${SERIF}`
  while (ctx.measureText(name).width > W - 520 && ns > 40) { ns -= 4; ctx.font = `700 ${ns}px ${SERIF}` }
  ctx.fillText(name, cx, 415)
  ctx.strokeStyle = GOLD; ctx.lineWidth = 1.5
  const uw = Math.min(W - 560, Math.max(320, ctx.measureText(name).width + 140))
  ctx.beginPath(); ctx.moveTo(cx - uw / 2, 448); ctx.lineTo(cx + uw / 2, 448); ctx.stroke()

  // 授予的称号
  ctx.fillStyle = MUTE
  ctx.font = `italic 400 27px ${SERIF}`
  ctx.fillText('in recognition of attaining the professional designation of', cx, 512)
  ctx.fillStyle = GOLD
  ctx.font = `700 44px ${SERIF}`
  ctx.fillText(spread((badge.titleEn || 'Certified Agent').toUpperCase(), 1), cx, 574)

  // 一句正文
  ctx.fillStyle = MUTE
  ctx.font = `400 22px ${SANS}`
  wrapCentered(ctx, 'Verified for professional standing on Pinzos, Dubai’s modern off-plan real-estate platform.', cx, 636, W - 360, 32)

  // 日期
  const d = new Date()
  const y4 = opts.dateStr ? opts.dateStr.slice(0, 4) : String(d.getFullYear())
  const mi = opts.dateStr ? Number(opts.dateStr.slice(5, 7)) - 1 : d.getMonth()
  const dateDisp = `${MONTHS_EN[mi] || ''} ${y4}`
  const no = certNumber(`${name}|${badge.planId}`)

  // 底部三栏:日期 | 金色认证徽章 | 凭证编号 + 验证链接
  sealMedal(ctx, cx, 930, 86)

  const lx = 320
  ctx.strokeStyle = NAVY; ctx.lineWidth = 1
  ctx.beginPath(); ctx.moveTo(lx - 130, 900); ctx.lineTo(lx + 130, 900); ctx.stroke()
  ctx.textAlign = 'center'
  ctx.fillStyle = GOLD; ctx.font = `600 15px ${SANS}`
  ctx.fillText(spread('DATE OF ISSUE', 2), lx, 936)
  ctx.fillStyle = NAVY; ctx.font = `italic 400 30px ${SERIF}`
  ctx.fillText(dateDisp, lx, 978)

  const rx = W - 320
  ctx.strokeStyle = NAVY; ctx.lineWidth = 1
  ctx.beginPath(); ctx.moveTo(rx - 130, 900); ctx.lineTo(rx + 130, 900); ctx.stroke()
  ctx.fillStyle = GOLD; ctx.font = `600 15px ${SANS}`
  ctx.fillText(spread('CREDENTIAL ID', 2), rx, 936)
  ctx.fillStyle = NAVY; ctx.font = `700 27px ${SERIF}`
  ctx.fillText(`PZ-${y4}-${no}`, rx, 976)
  ctx.fillStyle = MUTE; ctx.font = `400 16px ${SANS}`
  ctx.fillText('Verify at pinzos.com/verify', rx, 1004)
}
