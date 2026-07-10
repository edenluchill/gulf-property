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

// ── 学院派纸质文凭配色(参考 SFU / MIT 毕业证)────────────────
const BURG = '#6E1518'   // 深酒红(校名/人名/印章/分隔线)
const INK = '#33302A'    // 暖墨色(正文)
const MUTE = '#8A8270'   // 灰褐(次要文字)
const SERIF = 'Georgia, "Times New Roman", "PingFang SC", "Microsoft YaHei", serif'

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

/** 字间距(canvas 无原生 letter-spacing,用细空格近似拉开)。 */
function spread(s: string, n: number): string {
  return s.split('').join(String.fromCharCode(0x2009).repeat(Math.max(1, n)))
}

/** 居中自动换行(latin 按词、CJK 按字),返回实际行数。 */
function wrapCentered(ctx: CanvasRenderingContext2D, text: string, cx: number, y: number, maxW: number, lh: number): number {
  const cjk = /[一-鿿]/.test(text)
  const tokens = cjk ? text.split('') : text.split(' ')
  const glue = cjk ? '' : ' '
  const lines: string[] = []
  let cur = ''
  for (const t of tokens) {
    const trial = cur ? cur + glue + t : t
    if (ctx.measureText(trial).width > maxW && cur) { lines.push(cur); cur = t } else cur = trial
  }
  if (cur) lines.push(cur)
  lines.forEach((ln, i) => ctx.fillText(ln, cx, y + i * lh))
  return lines.length
}

/** 羊皮纸纤维质感 + 暗角 + 隐纹章。 */
function parchment(ctx: CanvasRenderingContext2D, W: number, H: number, emblemFn: () => void) {
  const g = ctx.createLinearGradient(0, 0, W, H)
  g.addColorStop(0, '#F5EEDB'); g.addColorStop(0.5, '#EFE7CF'); g.addColorStop(1, '#E7DCBE')
  ctx.fillStyle = g; ctx.fillRect(0, 0, W, H)
  // 纤维:大量极淡短线
  for (let i = 0; i < 5200; i++) {
    const x = Math.random() * W, y = Math.random() * H
    const a = Math.random() * Math.PI, len = 2 + Math.random() * 7
    ctx.strokeStyle = Math.random() > 0.5 ? 'rgba(120,100,60,0.05)' : 'rgba(255,250,235,0.06)'
    ctx.lineWidth = 1
    ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x + Math.cos(a) * len, y + Math.sin(a) * len); ctx.stroke()
  }
  // 隐纹章(浅底纹)
  ctx.save(); ctx.globalAlpha = 0.05; emblemFn(); ctx.restore()
  // 暗角
  const v = ctx.createRadialGradient(W / 2, H / 2, H * 0.34, W / 2, H / 2, H * 0.72)
  v.addColorStop(0, 'rgba(0,0,0,0)'); v.addColorStop(1, 'rgba(90,70,40,0.14)')
  ctx.fillStyle = v; ctx.fillRect(0, 0, W, H)
}

/** 纹章徽记(顶部小奖章 + 隐纹章共用):环 + 衬线 P + 两道横杠(呼应 Pinzos)。 */
function emblem(ctx: CanvasRenderingContext2D, cx: number, cy: number, r: number, color: string) {
  ctx.strokeStyle = color; ctx.fillStyle = color
  ctx.lineWidth = r * 0.06
  ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2); ctx.stroke()
  ctx.lineWidth = r * 0.03
  ctx.beginPath(); ctx.arc(cx, cy, r * 0.82, 0, Math.PI * 2); ctx.stroke()
  ctx.font = `700 ${r * 0.9}px ${SERIF}`
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle'
  ctx.fillText('P', cx, cy - r * 0.04)
  ctx.textBaseline = 'alphabetic'
}

/** 红蜡凸印。 */
function waxSeal(ctx: CanvasRenderingContext2D, cx: number, cy: number, r: number) {
  const pts = 44
  ctx.beginPath()
  for (let i = 0; i < pts * 2; i++) {
    const ang = (Math.PI * i) / pts
    const rad = i % 2 === 0 ? r : r * 0.9
    const x = cx + Math.cos(ang) * rad, y = cy + Math.sin(ang) * rad
    i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y)
  }
  ctx.closePath()
  const g = ctx.createRadialGradient(cx - r * 0.3, cy - r * 0.3, r * 0.1, cx, cy, r)
  g.addColorStop(0, '#A8342F'); g.addColorStop(1, '#7A1C1C')
  ctx.fillStyle = g; ctx.fill()
  ctx.strokeStyle = 'rgba(255,220,200,0.25)'; ctx.lineWidth = 2
  ctx.beginPath(); ctx.arc(cx, cy, r * 0.72, 0, Math.PI * 2); ctx.stroke()
  ctx.strokeStyle = 'rgba(60,10,10,0.35)'; ctx.lineWidth = 1.5
  ctx.beginPath(); ctx.arc(cx, cy, r * 0.6, 0, Math.PI * 2); ctx.stroke()
  ctx.fillStyle = 'rgba(255,225,205,0.9)'
  ctx.font = `700 ${r * 0.7}px ${SERIF}`
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle'
  ctx.fillText('P', cx, cy - r * 0.02)
  ctx.textBaseline = 'alphabetic'
}

/** 手写体签名(贝塞尔涂鸦 + 下划线)。 */
function signature(ctx: CanvasRenderingContext2D, x: number, y: number, w: number) {
  ctx.strokeStyle = '#2C2A3A'; ctx.lineWidth = 2.4; ctx.lineCap = 'round'
  ctx.beginPath()
  ctx.moveTo(x, y)
  ctx.bezierCurveTo(x + w * 0.12, y - 34, x + w * 0.22, y + 20, x + w * 0.33, y - 8)
  ctx.bezierCurveTo(x + w * 0.44, y - 32, x + w * 0.5, y + 22, x + w * 0.62, y - 4)
  ctx.bezierCurveTo(x + w * 0.72, y - 26, x + w * 0.86, y + 14, x + w, y - 12)
  ctx.stroke()
  ctx.lineWidth = 1
  ctx.beginPath(); ctx.moveTo(x - 6, y + 22); ctx.lineTo(x + w + 6, y + 22); ctx.strokeStyle = '#4a4436'; ctx.stroke()
}

const MONTHS_EN = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December']

/**
 * 画一张学院派纸质认证文凭(1080×1350 竖版,朋友圈/WhatsApp Status 用)。
 * 羊皮纸纤维质感 + 深酒红衬线校名 + 斜体人名 + 红蜡凸印 + 手写签名。
 * 参考真实大学毕业证(SFU / MIT)。头像可选(lt_agents.photo_url;跨域失败退首字母)。
 */
export async function drawCertificate(
  canvas: HTMLCanvasElement,
  badge: RoleBadge,
  opts: { name: string; zh: boolean; photoUrl?: string | null; dateStr?: string }
): Promise<void> {
  const W = 1080, H = 1350
  canvas.width = W; canvas.height = H
  const ctx = canvas.getContext('2d')
  if (!ctx) return
  const { name, zh } = opts
  const cx = W / 2

  // 纸 + 质感 + 隐纹章
  parchment(ctx, W, H, () => emblem(ctx, cx, H / 2, 300, BURG))

  // 边框:双细线 + 四角小菱形(经典雕版感)
  ctx.strokeStyle = BURG
  ctx.lineWidth = 3; ctx.strokeRect(56, 56, W - 112, H - 112)
  ctx.lineWidth = 1; ctx.strokeRect(70, 70, W - 140, H - 140)
  ctx.fillStyle = BURG
  for (const [x, y] of [[70, 70], [W - 70, 70], [70, H - 70], [W - 70, H - 70]]) {
    ctx.save(); ctx.translate(x, y); ctx.rotate(Math.PI / 4); ctx.fillRect(-7, -7, 14, 14); ctx.restore()
  }
  ctx.textAlign = 'center'

  // 顶部纹章
  emblem(ctx, cx, 168, 46, BURG)

  // 校名(大号衬线大写 + 强字间距)
  ctx.fillStyle = BURG
  ctx.font = `700 88px ${SERIF}`
  ctx.fillText(spread('PINZOS', 6), cx, 300)
  ctx.fillStyle = MUTE
  ctx.font = `600 25px ${SERIF}`
  ctx.fillText(spread(zh ? '迪拜房地产专业认证' : 'DUBAI REAL ESTATE CERTIFICATION', zh ? 3 : 2), cx, 344)
  // 短分隔线
  ctx.strokeStyle = BURG; ctx.lineWidth = 1.5
  ctx.beginPath(); ctx.moveTo(cx - 90, 372); ctx.lineTo(cx + 90, 372); ctx.stroke()

  // 引导语
  ctx.fillStyle = MUTE
  ctx.font = `600 26px ${SERIF}`
  ctx.fillText(spread(zh ? '兹证明' : 'THIS IS TO CERTIFY THAT', zh ? 4 : 2), cx, 452)

  // 可选头像(细酒红双环);有头像则人名下移
  const img = opts.photoUrl ? await loadImage(opts.photoUrl) : null
  let nameY = 560
  if (img) {
    const py = 560, pr = 80
    ctx.save()
    ctx.beginPath(); ctx.arc(cx, py, pr, 0, Math.PI * 2); ctx.clip()
    const s = Math.max((2 * pr) / img.width, (2 * pr) / img.height)
    ctx.drawImage(img, cx - (img.width * s) / 2, py - (img.height * s) / 2, img.width * s, img.height * s)
    ctx.restore()
    ctx.strokeStyle = BURG; ctx.lineWidth = 3
    ctx.beginPath(); ctx.arc(cx, py, pr + 6, 0, Math.PI * 2); ctx.stroke()
    ctx.lineWidth = 1
    ctx.beginPath(); ctx.arc(cx, py, pr + 12, 0, Math.PI * 2); ctx.stroke()
    nameY = 720
  }

  // 持有人真名(斜体衬线,过长自动缩)
  ctx.fillStyle = INK
  let ns = 88
  ctx.font = `italic 700 ${ns}px ${SERIF}`
  while (ctx.measureText(name).width > W - 300 && ns > 44) { ns -= 4; ctx.font = `italic 700 ${ns}px ${SERIF}` }
  ctx.fillText(name, cx, nameY)

  // 认证为
  ctx.fillStyle = MUTE
  ctx.font = `italic 400 27px ${SERIF}`
  ctx.fillText(zh ? '获认证为' : 'has been certified as a', cx, nameY + 56)

  // 角色称号(斜体酒红)
  ctx.fillStyle = BURG
  ctx.font = `italic 600 46px ${SERIF}`
  ctx.fillText(zh ? badge.titleZh : badge.titleEn, cx, nameY + 116)

  // 表彰正文(2 行)
  ctx.fillStyle = MUTE
  ctx.font = `400 25px ${SERIF}`
  const body = zh
    ? '以表彰其在 Pinzos 平台通过认证的专业地位 —— 迪拜期房购买的全新方式。'
    : 'In recognition of their verified professional standing on Pinzos — the modern way to buy off-plan property in Dubai.'
  wrapCentered(ctx, body, cx, nameY + 180, W - 300, 38)

  // 日期(斜体)
  const d = new Date()
  const y4 = opts.dateStr ? opts.dateStr.slice(0, 4) : String(d.getFullYear())
  const mi = opts.dateStr ? Number(opts.dateStr.slice(5, 7)) - 1 : d.getMonth()
  const dateDisp = zh ? `${y4} 年 ${mi + 1} 月` : `${MONTHS_EN[mi] || ''} ${y4}`
  ctx.fillStyle = INK
  ctx.font = `italic 400 30px ${SERIF}`
  ctx.fillText((zh ? '认证于 ' : 'Issued ') + dateDisp, cx, 1058)

  // 红蜡凸印(左) + 手写签名(右)
  waxSeal(ctx, 322, 1170, 74)
  signature(ctx, 600, 1150, 240)
  ctx.textAlign = 'center'
  ctx.fillStyle = INK
  ctx.font = `700 22px ${SERIF}`
  ctx.fillText('Pinzos', 720, 1200)
  ctx.fillStyle = MUTE
  ctx.font = `500 18px ${SERIF}`
  ctx.fillText(zh ? '认证机构' : 'Certification Authority', 720, 1224)

  // 底:编号 + 域名
  const no = certNumber(`${name}|${badge.planId}`)
  ctx.fillStyle = MUTE
  ctx.font = `400 22px ${SERIF}`
  ctx.fillText(`No. PZ-${y4}-${no}   ·   pinzos.com`, cx, 1264)
}
