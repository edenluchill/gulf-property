/**
 * 更新历史 —— 面向**客户**的「这周我们改了什么」。
 *
 * 🔴 **绝不要从 git commit 自动生成。**
 * commit 信息是写给自己看的:里面有收入数字、用户邮箱、「唯一付费客户扣款失败」
 * 这类东西,还有一堆客户根本不关心的内部实现。自动同步一次就会把它们公开出去,
 * 而且**收不回来**(页面会被爬、被缓存)。这份清单必须一条条手写、手筛。
 *
 * 写的时候只回答一个问题:**「这条对用户意味着什么?」**
 *   ✅「测距的距离数字挪到了线段中间，不再被端点挡住」
 *   ❌「修复 coords[floor(len/2)] 对两点线段取到终点的问题」
 *
 * 语言:只维护 zh + en。站点有 5 个语言,但更新日志逐条翻 5 份的维护成本会让它很快
 * 停更 —— 停更的更新日志比没有更糟(客户看到最后更新是三个月前)。其余语言回落英文。
 *
 * 加一条 = 在数组**开头**插一项。日期用发布日(YYYY-MM-DD)。
 */

export type ChangeKind = 'new' | 'improve' | 'fix'

export interface ChangeEntry {
  date: string          // YYYY-MM-DD
  kind: ChangeKind
  zh: string
  en: string
}

export const CHANGELOG: ChangeEntry[] = [
  {
    date: '2026-07-28',
    kind: 'improve',
    zh: '实时带看的底部工具条重做：画笔、语音、分享链接和搜索不再互相遮挡，手机上尤其明显。',
    en: 'Rebuilt the live-tour toolbar: the pen, voice, share link and search no longer overlap each other — a big difference on phones.',
  },
  {
    date: '2026-07-28',
    kind: 'fix',
    zh: '测距的距离数字现在显示在线段中间，不再被终点的圆点挡住；路线模式只报距离，不再显示会误导人的预估时间。',
    en: 'Distance labels now sit at the middle of the line instead of hiding behind the end marker. Route mode shows distance only — the estimated drive time was removed because it could not account for traffic.',
  },
  {
    date: '2026-07-28',
    kind: 'fix',
    zh: '画圈时的「半径」提示在英文/法文/俄文/阿拉伯文界面下会显示中文，已修。',
    en: 'The circle "radius" label showed Chinese text on non-Chinese interfaces. Fixed in all five languages.',
  },
  {
    date: '2026-07-27',
    kind: 'improve',
    zh: '带看结束后的意向报告改为提前生成，打开时几乎立刻出来（原先要等 6–8 秒）。',
    en: 'The post-tour interest report is now prepared as soon as the session ends, so it opens almost instantly instead of taking 6–8 seconds.',
  },
  {
    date: '2026-07-27',
    kind: 'improve',
    zh: '按区域筛选租金数据的速度提升约一倍。',
    en: 'Filtering rental data by area is now about twice as fast.',
  },
  {
    date: '2026-07-26',
    kind: 'fix',
    zh: '实时带看中拒绝了麦克风权限后，整场语音都连不上；现在会自动降级为「只听」，随时可以重新开麦。',
    en: 'Declining the microphone prompt used to break voice for the whole live tour. It now falls back to listen-only, and you can enable your mic again at any time.',
  },
  {
    date: '2026-07-26',
    kind: 'fix',
    zh: '晚进房的客户有时听不到语音、看不到摄像头，已修。',
    en: 'Clients who joined a live tour late sometimes could not hear audio or see the camera. Fixed.',
  },
  {
    date: '2026-07-25',
    kind: 'new',
    zh: '实时带看新增语音通话入口：客户可以主动呼叫经纪，并能看到当前是谁在说话。',
    en: 'Live tours got a proper voice-call entry point: clients can call the agent themselves, and everyone can see who is currently speaking.',
  },
  {
    date: '2026-07-25',
    kind: 'new',
    zh: '经纪台的「实时带看」页可以直接查看每一场的历史记录和客户意向报告。',
    en: 'The Live Tours tab in the agent console now lists every past session with its client-interest report.',
  },
]
