/**
 * 派单通知的**批量发送器** —— 攒一攒、隔 5 分钟发一次、多条合成一封。
 *
 * owner 2026-08-09:「不要一次性发,每次发的间隔要有 5 分钟,收集好 lead 一次性发给他」。
 *
 * 原来是 reveal 的瞬间同步发一封。同一个经纪短时间内被派到几条就收到几封,
 * 像在轰炸他 —— 而且我自己测试时已经这么轰过两个真实经纪各 2~3 封。
 *
 * 现在:reveal 只在库里留个待发标记(notified_at IS NULL),这里每分钟扫一次:
 *   · 距该经纪上次通知 ≥ 5 分钟才发
 *   · 把这段时间攒下的**全部 lead 合成一封**
 *
 * 🔴 **发信和标记必须原子**:先标记再发的话,发失败那条 lead 就永远不会再通知;
 *    先发再标记的话,进程在中间挂掉会重发。选后者 —— 重发一封总比一条 lead
 *    石沉大海好,而且 5 分钟节流本身就压住了重发的量。
 */
import pool from '../db/pool'
import { sendAlertEmail } from './notify'
import { buildOutreach, outreachLang } from '../lib/agentOutreachTemplate'

/** 同一个经纪两封通知之间的最小间隔。 */
const MIN_GAP_MINUTES = 5
/** 扫描频率。比间隔密得多没意义,但也别正好等于间隔(会让实际间隔变成两倍)。 */
const TICK_MS = 60_000

interface PendingRow {
  agent_id: string
  agent_email: string
  agent_name: string | null
  agent_brand: { title?: string } | null
  ids: string[]
  leads: {
    id: string
    created_at: string
    buyer_contact: string | null
    buyer_note: string | null
    buyer_lang: string | null
    project_name: string | null
  }[]
}

async function pending(): Promise<PendingRow[]> {
  const { rows } = await pool.query(
    `WITH last AS (
       SELECT agent_id, max(notified_at) AS t
         FROM agent_match_assignments
        WHERE notified_at IS NOT NULL
        GROUP BY agent_id
     )
     SELECT m.agent_id,
            a.email AS agent_email, a.display_name AS agent_name, a.brand AS agent_brand,
            array_agg(m.id::text ORDER BY m.created_at) AS ids,
            json_agg(json_build_object(
              'id', m.id::text, 'created_at', m.created_at,
              'buyer_contact', m.buyer_contact, 'buyer_note', m.buyer_note,
              'buyer_lang', m.buyer_lang,
              'project_name', (SELECT p.project_name FROM residential_projects p WHERE p.id = m.project_id)
            ) ORDER BY m.created_at) AS leads
       FROM agent_match_assignments m
       JOIN lt_agents a ON a.id = m.agent_id
       LEFT JOIN last l ON l.agent_id = m.agent_id
      /**
       * ⚠️ **不再要求 buyer_contact 非空。**
       * WhatsApp 渠道的买家是"拿了号自己去发消息"的,留联系方式是可选的 ——
       * 原来这里卡着非空,结果那种买家出现时经纪**一封邮件都收不到**,
       * 连"有人看过我的号"都不知道,而他的轮次已经被消耗掉了。
       * 现在照样通知,只是正文写法不同(见 compose 里的 hasContact 分支)。
       */
      WHERE m.notified_at IS NULL
        AND m.revealed_at IS NOT NULL
        AND (l.t IS NULL OR l.t < now() - interval '${MIN_GAP_MINUTES} minutes')
      GROUP BY m.agent_id, a.email, a.display_name, a.brand`
  )
  return rows as PendingRow[]
}

function compose(r: PendingRow): { subject: string; text: string } {
  const n = r.leads.length
  const first = r.leads[0]
  const subject = n > 1
    ? `【Pinzos】${n} 条新买家线索`
    : `【Pinzos】新买家线索${first.project_name ? ` · ${first.project_name}` : ''}`

  const anyContact = r.leads.some((L) => (L.buyer_contact || '').trim())
  const blocks = r.leads.map((L, i) => {
    const has = !!(L.buyer_contact || '').trim()
    // 模板按**买家**的语言 —— 收信的是买家,不是经纪
    const tpl = buildOutreach(outreachLang(L.buyer_lang), {
      agentName: r.agent_name,
      agentTitle: r.agent_brand?.title,
      projectName: L.project_name,
      buyerNote: L.buyer_note,
    })
    /**
     * 买家没留联系方式(WhatsApp 渠道下是允许的 —— 他拿了号自己去发消息)。
     * 这种**别给他模板** —— 没有收件地址,一封发不出去的信只会让人白忙。
     * 改成告诉他:会从哪来、该盯什么、等不到怎么把轮次要回去。
     */
    if (!has) {
      return [
        n > 1 ? `───────── 线索 ${i + 1}/${n} ─────────` : '─────────────────',
        L.project_name ? `项目:${L.project_name}` : '来源:地图',
        '这位买家**拿走了你的 WhatsApp / 电话,但没有留下自己的联系方式**。',
        '他很可能会直接发消息给你 —— 这两天留意一下陌生号码。',
        L.buyer_note ? `他留的话:${L.buyer_note}` : '',
        '',
        '如果一直没人来找你,在经纪台把这条标成「没联系上」——',
        '你的轮次会退回去,下一位买家还会轮到你。',
      ].filter(Boolean).join('\n')
    }
    return [
      n > 1 ? `───────── 线索 ${i + 1}/${n} ─────────` : '─────────────────',
      L.project_name ? `项目:${L.project_name}` : '来源:地图',
      `联系方式:${L.buyer_contact}`,
      `留言:${L.buyer_note || '(未填写)'}`,
      `买家语言:${L.buyer_lang || '未知(按英文处理)'}`,
      '',
      '可直接发给他的邮件:',
      `  主题:${tpl.subject}`,
      '',
      tpl.body.split('\n').map((x) => `  ${x}`).join('\n'),
    ].join('\n')
  })

  const text = [
    `${r.agent_name || ''}你好,`,
    '',
    n > 1
      ? `刚刚有 ${n} 位买家在 Pinzos 上请求联系顾问,系统按轮值把他们分给了你。`
      : '有位买家在 Pinzos 上请求联系顾问,系统按轮值把他分给了你。',
    '',
    ...blocks,
    '',
    '────────────',
    anyContact ? '上面的模板只是给你省事 —— 发信请用你自己的邮箱,署名和后续往来都在你手里。' : '',
    '在经纪台点「已跟进」之后,你才会重新进入排班接下一条:',
    'https://www.pinzos.com/agent/matches',
  ].join('\n')

  return { subject, text }
}

let timer: NodeJS.Timeout | null = null

export async function runAgentMatchNotifierOnce(): Promise<number> {
  let sent = 0
  try {
    for (const r of await pending()) {
      const { subject, text } = compose(r)
      const ok = await sendAlertEmail(subject, text, undefined, [r.agent_email])
      if (!ok) {
        // 发失败**不标记** —— 下一轮(5 分钟后)会再试,而不是把这条 lead 丢掉
        console.warn(`[agent-match-notify] send failed for ${r.agent_email}, will retry`)
        continue
      }
      await pool.query(
        `UPDATE agent_match_assignments SET notified_at = now() WHERE id = ANY($1::bigint[])`,
        [r.ids]
      )
      sent++
      console.log(`[agent-match-notify] sent ${r.leads.length} lead(s) to ${r.agent_email}`)
    }
  } catch (err) {
    // 通知器挂掉不能影响 API 主进程
    console.error('[agent-match-notify] tick failed:', err)
  }
  return sent
}

export function startAgentMatchNotifier(): void {
  if (timer) return
  timer = setInterval(() => { void runAgentMatchNotifierOnce() }, TICK_MS)
  // unref:这个定时器不该拖着进程不退出(部署时容器要能干净停掉)
  timer.unref?.()
  console.log(`[agent-match-notify] started (tick ${TICK_MS / 1000}s, min gap ${MIN_GAP_MINUTES}min)`)
}
