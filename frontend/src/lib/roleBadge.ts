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
    titleZh: '经纪会员', titleEn: 'Agent Member',
    certTitle: 'Pinzos Member',
    subZh: 'PINZOS 会员 · 启程', subEn: 'PINZOS Member · Starter',
    from: '#0f2b5b', to: '#1e40af', accent: '#60a5fa',
  },
  agent: {
    planId: 'agent', emoji: '🏅',
    titleZh: '金牌经纪人 PRO', titleEn: 'Pro Agent',
    certTitle: 'Pinzos Pro Member',
    subZh: 'PINZOS 会员 · 专业版', subEn: 'PINZOS Member · Pro',
    from: '#1e1b4b', to: '#4338ca', accent: '#fbbf24',
  },
  founder: {
    planId: 'founder', emoji: '🏢',
    titleZh: '经纪公司会员', titleEn: 'Agency Member',
    certTitle: 'Pinzos Agency Partner',
    subZh: 'PINZOS 会员 · 经纪公司', subEn: 'PINZOS Member · Agency',
    from: '#2e1065', to: '#7c3aed', accent: '#e9d5ff',
  },
  developer: {
    planId: 'developer', emoji: '🏗️',
    titleZh: '开发商会员', titleEn: 'Developer Member',
    certTitle: 'Pinzos Developer Partner',
    subZh: 'PINZOS 会员 · 开发商', subEn: 'PINZOS Member · Developer',
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
    titleZh: '经纪会员', titleEn: 'Agent Member',
    certTitle: 'Pinzos Team Member',
    subZh: 'PINZOS 会员 · 团队成员', subEn: 'PINZOS Member · Team',
    from: '#0f2b5b', to: '#1e40af', accent: '#60a5fa',
  },
  developer: {
    planId: 'member', emoji: '🏗️',
    titleZh: '开发商会员', titleEn: 'Developer Member',
    certTitle: 'Pinzos Developer Member',
    subZh: 'PINZOS 会员 · 团队成员', subEn: 'PINZOS Member · Team',
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

/** guilloche 玫瑰花纹(证券/钞票底纹):r(t)=R+amp·cos(petals·t)。 */
function guilloche(ctx: CanvasRenderingContext2D, cx: number, cy: number, R: number, petals: number, amp: number, alpha: number) {
  ctx.save(); ctx.globalAlpha = alpha; ctx.strokeStyle = GOLD; ctx.lineWidth = 1
  ctx.beginPath()
  const steps = 2400
  for (let i = 0; i <= steps; i++) {
    const t = (i / steps) * Math.PI * 2
    const r = R + amp * Math.cos(petals * t)
    const x = cx + Math.cos(t) * r, y = cy + Math.sin(t) * r
    i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y)
  }
  ctx.stroke(); ctx.restore()
}

/** 螺旋卷须(对数螺旋,filigree 灵魂):从 (cx,cy) 半径 r0→r1、角度扫 sweep。 */
function volute(ctx: CanvasRenderingContext2D, cx: number, cy: number, r0: number, r1: number, a0: number, sweep: number, lw: number) {
  ctx.lineWidth = lw; ctx.beginPath()
  const steps = 64
  for (let i = 0; i <= steps; i++) {
    const t = i / steps
    const a = a0 + sweep * t
    const r = r0 * Math.pow(r1 / r0, t)
    const x = cx + Math.cos(a) * r, y = cy + Math.sin(a) * r
    i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y)
  }
  ctx.stroke()
}

/** 一片细长卷叶(火焰/佩斯利形,带尖 + 内凹回弯 + 细中脉);x,y=叶柄,ang=朝向,len=长,side=弯向。 */
function scrollLeaf(ctx: CanvasRenderingContext2D, x: number, y: number, len: number, ang: number, side: number) {
  ctx.save(); ctx.translate(x, y); ctx.rotate(ang)
  ctx.beginPath()
  ctx.moveTo(0, 0)
  ctx.bezierCurveTo(len * 0.30 * side, -len * 0.10, len * 0.46 * side, -len * 0.52, len * 0.10 * side, -len)  // 外缘鼓 → 尖
  ctx.bezierCurveTo(len * 0.20 * side, -len * 0.5, len * 0.02 * side, -len * 0.20, 0, 0)                       // 内缘回弯(凹)
  ctx.closePath(); ctx.fill()
  // 细中脉(深金一道,提气免得像实心虫)
  ctx.strokeStyle = 'rgba(90,66,24,0.55)'; ctx.lineWidth = Math.max(0.8, len * 0.03)
  ctx.beginPath(); ctx.moveTo(0, 0)
  ctx.bezierCurveTo(len * 0.14 * side, -len * 0.4, len * 0.12 * side, -len * 0.7, len * 0.10 * side, -len * 0.94)
  ctx.stroke()
  ctx.restore()
}

/** 小花(5 瓣水滴 + 花心);线稿 + 花心实心。 */
function rosette(ctx: CanvasRenderingContext2D, cx: number, cy: number, r: number, lw: number) {
  ctx.lineWidth = lw
  for (let i = 0; i < 5; i++) {
    const a = -Math.PI / 2 + (i * 2 * Math.PI) / 5
    ctx.save(); ctx.translate(cx, cy); ctx.rotate(a)
    ctx.beginPath()
    ctx.moveTo(0, 0)
    ctx.bezierCurveTo(-r * 0.34, -r * 0.5, -r * 0.24, -r, 0, -r)
    ctx.bezierCurveTo(r * 0.24, -r, r * 0.34, -r * 0.5, 0, 0)
    ctx.stroke()
    ctx.restore()
  }
  ctx.beginPath(); ctx.arc(cx, cy, r * 0.18, 0, Math.PI * 2); ctx.fill()
}

/**
 * 阿拉伯卷草花纹(线条美,参考用户给的 filigree):一条主 S 卷藤两端收成螺旋卷,
 * 分出次级小卷,点缀卷叶与一朵小花。克制、流畅、留白干净(不堆密)。
 * 画在 (ox,oy) 局部坐标,sc 缩放,fx/fy 镜像(±1),用于对称放到两角。
 */
function flourish(ctx: CanvasRenderingContext2D, ox: number, oy: number, sc: number, fx: number, fy: number, alpha: number) {
  ctx.save(); ctx.globalAlpha = alpha
  ctx.translate(ox, oy); ctx.scale(sc * fx, sc * fy)
  const gg = ctx.createLinearGradient(0, -160, 0, 20)
  gg.addColorStop(0, '#D9B968'); gg.addColorStop(1, '#9A7628')
  ctx.strokeStyle = gg; ctx.fillStyle = gg; ctx.lineCap = 'round'; ctx.lineJoin = 'round'

  // 主 S 藤:从内(0,0)向外上扬,末端收成大螺旋卷
  ctx.lineWidth = 2.4
  ctx.beginPath()
  ctx.moveTo(0, 0)
  ctx.bezierCurveTo(72, -6, 150, -32, 205, -92)
  ctx.stroke()
  volute(ctx, 214, -128, 42, 7, Math.PI * 0.25, Math.PI * 1.7, 2.4)   // 末端大卷

  // 次级下卷(主藤起点分出,向左下收卷)
  ctx.lineWidth = 2
  ctx.beginPath(); ctx.moveTo(36, -3); ctx.bezierCurveTo(18, -30, 34, -64, 70, -62); ctx.stroke()
  volute(ctx, 70, -62, 18, 3.5, Math.PI * 1.5, Math.PI * 1.55, 2)

  // 中段上卷小须(从主藤凸侧抽出)
  ctx.lineWidth = 1.7
  ctx.beginPath(); ctx.moveTo(128, -26); ctx.bezierCurveTo(152, -36, 166, -62, 148, -84); ctx.stroke()
  volute(ctx, 148, -84, 13, 2.6, 0, Math.PI * 1.4, 1.7)

  // 卷叶(沿藤外侧单侧生长,细长优雅,不成对)
  scrollLeaf(ctx, 74, -12, 54, -Math.PI * 0.70, 1)
  scrollLeaf(ctx, 132, -48, 46, -Math.PI * 0.34, -1)

  // 小花(藤起点上方作焦点,远离叶片)
  rosette(ctx, 26, -44, 14, 1.5)

  ctx.restore()
}

/** 一支金桂冠(沿弧排小叶片)。 */
function laurel(ctx: CanvasRenderingContext2D, cx: number, cy: number, R: number, a0: number, a1: number, side: number, leafR: number) {
  ctx.fillStyle = GOLD
  const n = 8
  for (let i = 0; i < n; i++) {
    const a = a0 + (a1 - a0) * (i / (n - 1))
    const x = cx + Math.cos(a) * R, y = cy + Math.sin(a) * R
    ctx.save(); ctx.translate(x, y); ctx.rotate(a + side * Math.PI / 2)
    ctx.beginPath(); ctx.ellipse(leafR * 0.9, 0, leafR, leafR * 0.4, 0, 0, Math.PI * 2); ctx.fill()
    ctx.restore()
  }
}

/** 顶部权威徽记:金环 + 桂冠 + 星。 */
function crest(ctx: CanvasRenderingContext2D, cx: number, cy: number, r: number) {
  const gg = goldGrad(ctx, cy - r, cy + r)
  ctx.strokeStyle = gg; ctx.lineWidth = 2
  ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2); ctx.stroke()
  ctx.lineWidth = 1
  ctx.beginPath(); ctx.arc(cx, cy, r * 0.78, 0, Math.PI * 2); ctx.stroke()
  laurel(ctx, cx, cy, r * 0.56, Math.PI * 0.66, Math.PI * 0.98, 1, r * 0.1)
  laurel(ctx, cx, cy, r * 0.56, Math.PI * 0.34, Math.PI * 0.02, -1, r * 0.1)
  star(ctx, cx, cy - r * 0.04, r * 0.3, gg)
}

/** 干净的金色认证徽章(烫金双环 + 币缘点 + 桂冠 + 星 + CERTIFIED / PINZOS)。 */
function sealMedal(ctx: CanvasRenderingContext2D, cx: number, cy: number, r: number) {
  const gg = goldGrad(ctx, cy - r, cy + r)
  ctx.fillStyle = 'rgba(176,138,60,0.06)'
  ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2); ctx.fill()
  ctx.strokeStyle = gg; ctx.lineWidth = 3
  ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2); ctx.stroke()
  ctx.lineWidth = 1
  ctx.beginPath(); ctx.arc(cx, cy, r * 0.8, 0, Math.PI * 2); ctx.stroke()
  ctx.fillStyle = gg
  const dots = 52
  for (let i = 0; i < dots; i++) {
    const a = (2 * Math.PI * i) / dots
    ctx.beginPath(); ctx.arc(cx + Math.cos(a) * r * 0.9, cy + Math.sin(a) * r * 0.9, 1.5, 0, Math.PI * 2); ctx.fill()
  }
  // 桂冠环抱下半
  laurel(ctx, cx, cy, r * 0.66, Math.PI * 0.58, Math.PI * 0.92, 1, r * 0.055)
  laurel(ctx, cx, cy, r * 0.66, Math.PI * 0.42, Math.PI * 0.08, -1, r * 0.055)
  star(ctx, cx, cy - r * 0.34, r * 0.15, gg)
  ctx.textAlign = 'center'
  ctx.fillStyle = NAVY
  ctx.font = `700 ${Math.round(r * 0.185)}px ${SANS}`
  ctx.fillText(spread('MEMBER', 2), cx, cy + r * 0.06)
  ctx.fillStyle = gg
  ctx.font = `600 ${Math.round(r * 0.13)}px ${SANS}`
  ctx.fillText(spread('PINZOS', 2), cx, cy + r * 0.34)
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

/** 微暖白安全纸:细纤维 + guilloche 玫瑰花纹 + 轻暗角。 */
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
  // guilloche 玫瑰花纹(层叠;证券底纹质感)
  const cx = W / 2, cy = H * 0.52
  guilloche(ctx, cx, cy, 300, 44, 24, 0.05)
  guilloche(ctx, cx, cy, 230, 36, 20, 0.05)
  guilloche(ctx, cx, cy, 150, 28, 16, 0.045)
  const v = ctx.createRadialGradient(cx, H / 2, H * 0.42, cx, H / 2, H * 0.92)
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

  paper(ctx, W, H)

  // 边框:烫金双线 + 四角小菱形 + 角内短饰线
  ctx.strokeStyle = goldGrad(ctx, 40, H - 40)
  ctx.lineWidth = 2.5; ctx.strokeRect(46, 46, W - 92, H - 92)
  ctx.lineWidth = 1; ctx.strokeRect(58, 58, W - 116, H - 116)
  ctx.fillStyle = GOLD
  for (const [x, y, sx, sy] of [[58, 58, 1, 1], [W - 58, 58, -1, 1], [58, H - 58, 1, -1], [W - 58, H - 58, -1, -1]] as number[][]) {
    ctx.save(); ctx.translate(x, y); ctx.rotate(Math.PI / 4); ctx.fillRect(-6, -6, 12, 12); ctx.restore()
    ctx.strokeStyle = GOLD; ctx.lineWidth = 1.5
    ctx.beginPath(); ctx.moveTo(x + sx * 26, y); ctx.lineTo(x + sx * 64, y); ctx.stroke()
    ctx.beginPath(); ctx.moveTo(x, y + sy * 26); ctx.lineTo(x, y + sy * 64); ctx.stroke()
  }
  // 阿拉伯卷草花纹:顶部两角对称,向内下方流动(留白区,不压 crest/文字)
  flourish(ctx, 150, 150, 0.85, 1, -1, 0.62)
  flourish(ctx, W - 150, 150, 0.85, -1, -1, 0.62)

  ctx.textAlign = 'center'

  // 顶部权威徽记
  crest(ctx, cx, 122, 42)

  // 机构标识(masthead)
  ctx.fillStyle = NAVY
  ctx.font = `700 70px ${SERIF}`
  ctx.fillText(spread('PINZOS', 6), cx, 232)
  ctx.fillStyle = goldGrad(ctx, 254, 278)
  ctx.font = `600 22px ${SANS}`
  ctx.fillText(spread('AGENT PARTNER NETWORK', 3), cx, 274)
  ctx.strokeStyle = goldGrad(ctx, 296, 302); ctx.lineWidth = 1.5
  ctx.beginPath(); ctx.moveTo(cx - 165, 300); ctx.lineTo(cx + 165, 300); ctx.stroke()

  // 引导语
  ctx.fillStyle = MUTE
  ctx.font = `600 21px ${SANS}`
  ctx.fillText(spread('PINZOS PROUDLY WELCOMES', 2), cx, 372)

  // 姓名(衬线主视觉,过长自动缩)+ 烫金下划线
  ctx.fillStyle = NAVY
  let ns = 82
  ctx.font = `700 ${ns}px ${SERIF}`
  while (ctx.measureText(name).width > W - 540 && ns > 40) { ns -= 4; ctx.font = `700 ${ns}px ${SERIF}` }
  ctx.fillText(name, cx, 464)
  const uw = Math.min(W - 560, Math.max(320, ctx.measureText(name).width + 140))
  ctx.strokeStyle = goldGrad(ctx, 492, 498); ctx.lineWidth = 1.5
  ctx.beginPath(); ctx.moveTo(cx - uw / 2, 496); ctx.lineTo(cx + uw / 2, 496); ctx.stroke()

  // 授予的称号(逐档不同头衔;过长自动缩)
  ctx.fillStyle = MUTE
  ctx.font = `italic 400 26px ${SERIF}`
  ctx.fillText('welcomed to the Pinzos platform as a', cx, 556)
  const title = spread((badge.certTitle || 'Certified Agent').toUpperCase(), 1)
  let ts = 44
  ctx.font = `700 ${ts}px ${SERIF}`
  while (ctx.measureText(title).width > W - 460 && ts > 28) { ts -= 2; ctx.font = `700 ${ts}px ${SERIF}` }
  ctx.fillStyle = goldGrad(ctx, 596 - ts, 606)
  ctx.fillText(title, cx, 610)

  // 一句正文
  ctx.fillStyle = MUTE
  ctx.font = `400 21px ${SANS}`
  wrapCentered(ctx, 'A valued member of Pinzos, Dubai’s modern off-plan real-estate platform.', cx, 668, W - 340, 30)

  // 日期
  const d = new Date()
  const y4 = opts.dateStr ? opts.dateStr.slice(0, 4) : String(d.getFullYear())
  const mi = opts.dateStr ? Number(opts.dateStr.slice(5, 7)) - 1 : d.getMonth()
  const dateDisp = `${MONTHS_EN[mi] || ''} ${y4}`
  const credentialId = opts.credentialId || `PZ-${y4}-${certNumber(`${name}|${badge.planId}`)}`

  // 底部三栏:日期 | 金色认证徽章 | 二维码 + 凭证编号(可扫验证)
  sealMedal(ctx, cx, 942, 88)

  const lx = 300
  ctx.strokeStyle = goldGrad(ctx, 906, 912); ctx.lineWidth = 1
  ctx.beginPath(); ctx.moveTo(lx - 120, 908); ctx.lineTo(lx + 120, 908); ctx.stroke()
  ctx.textAlign = 'center'
  ctx.fillStyle = goldGrad(ctx, 932, 948); ctx.font = `600 15px ${SANS}`
  ctx.fillText(spread('MEMBER SINCE', 2), lx, 944)
  ctx.fillStyle = NAVY; ctx.font = `italic 400 30px ${SERIF}`
  ctx.fillText(dateDisp, lx, 986)

  // 右栏:真实二维码(扫码到公开验证页)+ 凭证编号
  const rx = W - 300
  const origin = (typeof window !== 'undefined' && window.location?.origin) || 'https://pinzos.com'
  const verifyUrl = `${origin}/verify/${credentialId}`
  const qrSize = 108
  const ok = await drawQR(ctx, verifyUrl, rx - qrSize / 2, 858, qrSize)
  ctx.textAlign = 'center'
  ctx.fillStyle = NAVY; ctx.font = `700 22px ${SERIF}`
  ctx.fillText(credentialId, rx, 998)
  ctx.fillStyle = MUTE; ctx.font = `400 15px ${SANS}`
  ctx.fillText(ok ? 'Scan to view · pinzos.com' : 'pinzos.com', rx, 1022)
}
