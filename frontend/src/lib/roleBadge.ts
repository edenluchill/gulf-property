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

// ── 证书配色(浅色烫金奖状)────────────────────────────────
const GOLD = '#C9A227'
const GOLD_DK = '#A67C1A'
const GOLD_LT = '#E7CC77'
const INK = '#1e2a35'

/** 稳定的证书编号(按持有人 + 档位派生,不随每次生成变化)。 */
function certNumber(seed: string): string {
  let h = 0
  for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) >>> 0
  return String(h % 1000000).padStart(6, '0')
}

function loadImage(url: string): Promise<HTMLImageElement | null> {
  return new Promise((resolve) => {
    const img = new Image()
    img.crossOrigin = 'anonymous'
    img.onload = () => resolve(img)
    img.onerror = () => resolve(null)
    img.src = url
  })
}

/** 圆角矩形描边路径。 */
function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath()
  ctx.moveTo(x + r, y)
  ctx.arcTo(x + w, y, x + w, y + h, r)
  ctx.arcTo(x + w, y + h, x, y + h, r)
  ctx.arcTo(x, y + h, x, y, r)
  ctx.arcTo(x, y, x + w, y, r)
  ctx.closePath()
}

/** 四角小菱形装饰。 */
function corner(ctx: CanvasRenderingContext2D, x: number, y: number, s: number) {
  ctx.save()
  ctx.translate(x, y)
  ctx.rotate(Math.PI / 4)
  ctx.fillStyle = GOLD
  ctx.fillRect(-s / 2, -s / 2, s, s)
  ctx.restore()
}

/**
 * 画一张「浅色烫金认证奖状」(1080×1350 竖版,朋友圈/WhatsApp Status 用)。
 * 米白底 + 金色双描边 + 圆形头像 + 持有人真名 + 角色称号 + 证书编号 + 金印。
 * 头像来自 lt_agents.photo_url(可空;跨域需 R2 CORS,失败则用首字母兜底)。
 */
export async function drawCertificate(
  canvas: HTMLCanvasElement,
  badge: RoleBadge,
  opts: { name: string; zh: boolean; photoUrl?: string | null; dateStr?: string }
): Promise<void> {
  const W = 1080, H = 1350
  canvas.width = W
  canvas.height = H
  const ctx = canvas.getContext('2d')
  if (!ctx) return
  const { name, zh } = opts
  ctx.textAlign = 'center'

  // 背景:暖象牙渐变
  const bg = ctx.createLinearGradient(0, 0, 0, H)
  bg.addColorStop(0, '#FCF9F1')
  bg.addColorStop(1, '#F4EDDD')
  ctx.fillStyle = bg
  ctx.fillRect(0, 0, W, H)

  // 金色双描边边框 + 四角菱形
  roundRect(ctx, 44, 44, W - 88, H - 88, 18)
  ctx.strokeStyle = GOLD
  ctx.lineWidth = 8
  ctx.stroke()
  roundRect(ctx, 64, 64, W - 128, H - 128, 12)
  ctx.strokeStyle = `${GOLD_DK}88`
  ctx.lineWidth = 2
  ctx.stroke()
  for (const [cxp, cyp] of [[92, 92], [W - 92, 92], [92, H - 92], [W - 92, H - 92]]) corner(ctx, cxp, cyp, 16)

  // 顶部品牌
  ctx.fillStyle = INK
  ctx.font = '600 50px Georgia, "Times New Roman", serif'
  ctx.fillText('Pinzos', W / 2, 168)
  ctx.fillStyle = GOLD_DK
  ctx.font = '600 25px system-ui, sans-serif'
  ctx.fillText(spread(zh ? '官方认证' : 'OFFICIAL CERTIFICATION', zh ? 8 : 6), W / 2, 210)

  // 圆形头像(或首字母金圆)
  const cx = W / 2, cyA = 400, r = 112
  const img = opts.photoUrl ? await loadImage(opts.photoUrl) : null
  // 金环
  ctx.beginPath(); ctx.arc(cx, cyA, r + 10, 0, Math.PI * 2)
  ctx.strokeStyle = GOLD; ctx.lineWidth = 6; ctx.stroke()
  if (img) {
    ctx.save()
    ctx.beginPath(); ctx.arc(cx, cyA, r, 0, Math.PI * 2); ctx.clip()
    // cover 裁剪
    const s = Math.max((2 * r) / img.width, (2 * r) / img.height)
    const dw = img.width * s, dh = img.height * s
    ctx.drawImage(img, cx - dw / 2, cyA - dh / 2, dw, dh)
    ctx.restore()
  } else {
    const g = ctx.createLinearGradient(cx, cyA - r, cx, cyA + r)
    g.addColorStop(0, GOLD_LT); g.addColorStop(1, GOLD)
    ctx.fillStyle = g
    ctx.beginPath(); ctx.arc(cx, cyA, r, 0, Math.PI * 2); ctx.fill()
    ctx.fillStyle = '#fff'
    ctx.font = '700 96px Georgia, serif'
    ctx.textBaseline = 'middle'
    ctx.fillText((name || 'P').charAt(0).toUpperCase(), cx, cyA + 6)
    ctx.textBaseline = 'alphabetic'
  }

  // 认证引导语
  ctx.fillStyle = '#8a8270'
  ctx.font = '500 27px system-ui, sans-serif'
  ctx.fillText(zh ? '兹  认  证' : 'THIS CERTIFIES THAT', W / 2, 620)

  // 持有人真名(衬线大字,过长自动缩)
  ctx.fillStyle = INK
  let nameSize = 82
  ctx.font = `700 ${nameSize}px Georgia, "PingFang SC", "Microsoft YaHei", serif`
  while (ctx.measureText(name).width > W - 260 && nameSize > 40) {
    nameSize -= 4
    ctx.font = `700 ${nameSize}px Georgia, "PingFang SC", "Microsoft YaHei", serif`
  }
  ctx.fillText(name, W / 2, 720)

  // 角色称号(金色)
  ctx.fillStyle = GOLD_DK
  ctx.font = '600 42px system-ui, "PingFang SC", sans-serif'
  ctx.fillText(zh ? badge.titleZh : badge.titleEn, W / 2, 792)

  // 金色分隔线 + 中心菱形
  ctx.strokeStyle = `${GOLD}aa`; ctx.lineWidth = 2
  ctx.beginPath(); ctx.moveTo(W / 2 - 200, 850); ctx.lineTo(W / 2 - 22, 850); ctx.stroke()
  ctx.beginPath(); ctx.moveTo(W / 2 + 22, 850); ctx.lineTo(W / 2 + 200, 850); ctx.stroke()
  corner(ctx, W / 2, 850, 12)

  // 认证等级副标题
  ctx.fillStyle = '#a49c88'
  ctx.font = '500 28px system-ui, "PingFang SC", sans-serif'
  ctx.fillText(zh ? badge.subZh : badge.subEn, W / 2, 902)

  // 金印章(圆形烫金 stamp)
  const sy = 1030, sr = 66
  ctx.beginPath(); ctx.arc(cx, sy, sr, 0, Math.PI * 2)
  ctx.strokeStyle = GOLD; ctx.lineWidth = 4; ctx.stroke()
  ctx.beginPath(); ctx.arc(cx, sy, sr - 10, 0, Math.PI * 2)
  ctx.strokeStyle = `${GOLD_DK}99`; ctx.lineWidth = 1.5; ctx.stroke()
  ctx.fillStyle = GOLD_DK
  ctx.font = '700 44px system-ui, "Segoe UI Symbol", sans-serif'
  ctx.textBaseline = 'middle'
  ctx.fillText('✓', cx, sy + 3)
  ctx.textBaseline = 'alphabetic'
  ctx.font = '600 15px system-ui, sans-serif'
  ctx.fillText(spread('VERIFIED', 3), cx, sy + sr + 30)

  // 证书编号 + 日期
  const d = opts.dateStr ? null : new Date()
  const dateStr = opts.dateStr || (d ? `${d.getFullYear()}.${String(d.getMonth() + 1).padStart(2, '0')}.${String(d.getDate()).padStart(2, '0')}` : '')
  const year = dateStr.slice(0, 4)
  const no = certNumber(`${name}|${badge.planId}`)
  ctx.fillStyle = '#8a8270'
  ctx.font = '500 26px system-ui, sans-serif'
  ctx.fillText(`No. PZ-${year}-${no}    ·    ${(zh ? '认证日期 ' : 'Issued ') + dateStr}`, W / 2, 1200)

  // 底部域名
  ctx.fillStyle = GOLD_DK
  ctx.font = '600 30px Georgia, serif'
  ctx.fillText('pinzos.com', W / 2, 1262)
}

/** 字间距(canvas 无原生 letter-spacing,手动拉开)。 */
function spread(s: string, px: number): string {
  // 用细空格近似字间距(简单可靠,跨平台一致)
  return s.split('').join(String.fromCharCode(0x2009).repeat(Math.max(1, Math.round(px / 4))))
}
