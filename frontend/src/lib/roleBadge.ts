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

/** 画 1080×1350 朋友圈分享卡(纯 canvas,零依赖)。 */
export function drawBadgeCard(
  canvas: HTMLCanvasElement,
  badge: RoleBadge,
  opts: { name: string; zh: boolean }
): void {
  const W = 1080
  const H = 1350
  canvas.width = W
  canvas.height = H
  const ctx = canvas.getContext('2d')
  if (!ctx) return
  const { name, zh } = opts

  // 背景:角色专属深色渐变 + 细网格质感
  const bg = ctx.createLinearGradient(0, 0, W, H)
  bg.addColorStop(0, badge.from)
  bg.addColorStop(1, badge.to)
  ctx.fillStyle = bg
  ctx.fillRect(0, 0, W, H)
  ctx.strokeStyle = 'rgba(255,255,255,0.05)'
  ctx.lineWidth = 1
  for (let x = 0; x <= W; x += 54) { ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, H); ctx.stroke() }
  for (let y = 0; y <= H; y += 54) { ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(W, y); ctx.stroke() }

  // 顶部品牌
  ctx.textAlign = 'center'
  ctx.fillStyle = 'rgba(255,255,255,0.92)'
  ctx.font = '600 44px Georgia, serif'
  ctx.fillText('Pinzos', W / 2, 120)
  ctx.fillStyle = 'rgba(255,255,255,0.55)'
  ctx.font = '500 26px system-ui, sans-serif'
  ctx.fillText(zh ? '迪拜期房购买新方式' : 'A new way to buy off-plan in Dubai', W / 2, 164)

  // 徽章圆:外光晕 + 双层圆 + emoji
  const cx = W / 2
  const cy = 520
  const glow = ctx.createRadialGradient(cx, cy, 60, cx, cy, 330)
  glow.addColorStop(0, `${badge.accent}55`)
  glow.addColorStop(1, 'transparent')
  ctx.fillStyle = glow
  ctx.fillRect(cx - 340, cy - 340, 680, 680)

  ctx.beginPath()
  ctx.arc(cx, cy, 208, 0, Math.PI * 2)
  ctx.strokeStyle = badge.accent
  ctx.lineWidth = 6
  ctx.stroke()

  ctx.beginPath()
  ctx.arc(cx, cy, 184, 0, Math.PI * 2)
  const inner = ctx.createLinearGradient(cx, cy - 184, cx, cy + 184)
  inner.addColorStop(0, 'rgba(255,255,255,0.16)')
  inner.addColorStop(1, 'rgba(255,255,255,0.04)')
  ctx.fillStyle = inner
  ctx.fill()

  ctx.font = '190px system-ui, "Segoe UI Emoji", "Apple Color Emoji", sans-serif'
  ctx.textBaseline = 'middle'
  ctx.fillText(badge.emoji, cx, cy + 12)
  ctx.textBaseline = 'alphabetic'

  // 称号
  ctx.fillStyle = '#ffffff'
  ctx.font = '800 88px system-ui, "PingFang SC", "Microsoft YaHei", sans-serif'
  ctx.fillText(zh ? badge.titleZh : badge.titleEn, W / 2, 880)
  ctx.fillStyle = badge.accent
  ctx.font = '600 36px system-ui, sans-serif'
  ctx.fillText(zh ? badge.subZh : badge.subEn, W / 2, 944)

  // 分隔线
  ctx.strokeStyle = 'rgba(255,255,255,0.22)'
  ctx.lineWidth = 2
  ctx.beginPath()
  ctx.moveTo(W / 2 - 190, 1000)
  ctx.lineTo(W / 2 + 190, 1000)
  ctx.stroke()

  // 持有人 + 日期
  ctx.fillStyle = 'rgba(255,255,255,0.9)'
  ctx.font = '600 44px system-ui, "PingFang SC", sans-serif'
  ctx.fillText(name, W / 2, 1076)
  const d = new Date()
  const dateStr = `${d.getFullYear()}.${String(d.getMonth() + 1).padStart(2, '0')}.${String(d.getDate()).padStart(2, '0')}`
  ctx.fillStyle = 'rgba(255,255,255,0.5)'
  ctx.font = '500 30px system-ui, sans-serif'
  ctx.fillText((zh ? '认证日期 ' : 'Certified on ') + dateStr, W / 2, 1130)

  // 底部
  ctx.fillStyle = 'rgba(255,255,255,0.65)'
  ctx.font = '600 32px system-ui, sans-serif'
  ctx.fillText('pinzos.com', W / 2, 1262)
}
