/**
 * 项目页头部那一排操作(找顾问 / 分享 / 复制笔记 / 收藏)的**唯一样式来源**。
 *
 * 单独抽一个文件、而不是写在 ProjectActionBar 里,是为了让 FindAgentChip 也能用
 * 同一套 class —— 那个件既要能进这一排(bar),又要能在区域弹窗里单独站着(standalone)。
 * 写在组件里会变成 ProjectActionBar ⇄ FindAgentChip 的循环 import。
 *
 * 设计意图(owner 2026-08-11:「现代化高级一点、专业、要有好的 animation」):
 *   · 四颗按钮不再是四个各自带边框的方盒子,而是**一个玻璃胶囊里的分段控件** ——
 *     边框只有外面一圈,里面靠 hover 底色区分,视觉噪音降到最低;
 *   · 高度压到 32px、字号 13px,比原来的 h-9/14px 更克制,更像专业工具而不是落地页;
 *   · 阴影是「一层贴地的硬阴影 + 一层很散的软阴影」——白底控件靠单层 shadow-md
 *     会发灰,两层才是浮起来的样子。
 *
 * 🔴 **颜色必须从 tone 走,别在调用处拼 `text-*`**。base 里已经有 `text-slate-600`,
 *    再拼一个 `text-teal-700` 上去,谁赢取决于 Tailwind 生成 CSS 的先后顺序,
 *    不是字符串顺序 —— 会变成「本地好好的,build 完颜色不对」这种查半天的问题。
 */

/** 外面那圈玻璃胶囊 */
export const ACTION_BAR =
  'inline-flex items-center gap-0.5 rounded-full border border-slate-200/80 bg-white/80 p-1 ' +
  'backdrop-blur-md shadow-[0_1px_2px_rgba(15,23,42,0.05),0_10px_30px_-16px_rgba(15,23,42,0.3)]'

const TONE = {
  /** 次要动作:分享 / 复制 */
  slate: 'text-slate-600 hover:bg-slate-100 hover:text-slate-900',
  /** 主动作:找顾问 —— 这一排唯一带颜色的,也是唯一能带来生意的 */
  teal: 'text-teal-700 hover:bg-teal-50 hover:text-teal-800',
  /** 已收藏 */
  rose: 'bg-rose-50 text-rose-600 hover:bg-rose-100 hover:text-rose-700',
} as const

/** 胶囊里的一颗。compact = 只有图标(手机档) */
export const actionItem = (
  { compact, tone = 'slate' }: { compact?: boolean; tone?: keyof typeof TONE } = {},
) =>
  'group relative inline-flex items-center justify-center rounded-full font-medium ' +
  'text-[13px] leading-none transition-colors duration-200 ' +
  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-500/40 ' +
  (compact ? 'h-8 w-8 ' : 'h-8 gap-1.5 px-3 ') +
  TONE[tone]

/** 分段之间那道竖线 —— 把「找顾问」(要人)和后面三颗(收着这一页)分开 */
export const ACTION_DIVIDER = 'mx-1 h-4 w-px shrink-0 bg-slate-200'

/** 按下/悬停的手感 —— 四颗共用,不然会一颗一个脾气 */
export const ACTION_MOTION = {
  whileHover: { y: -1 },
  whileTap: { scale: 0.94 },
  transition: { type: 'spring' as const, stiffness: 420, damping: 26 },
}
