/**
 * 生成客户反馈邮件的 HTML 模板（品牌壳共用，只有称呼/三条问题/结尾不同）。
 *   node docs/email-templates/build.mjs
 * 改文案只改下面的 VARIANTS，别手改生成出来的 .html。
 */
import { writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const OUT = dirname(fileURLToPath(import.meta.url))

const TEAL = '#0d9488'
const AMBER = '#f59e0b'

const FONT_LATIN = `-apple-system,'Segoe UI',Roboto,'Helvetica Neue',Arial,sans-serif`
const FONT_CJK = `-apple-system,'PingFang SC','Microsoft YaHei','Hiragino Sans GB',${FONT_LATIN}`

/** 一条编号问题 */
const item = (n, html, color) => `
              <tr>
                <td width="34" valign="top" style="padding-bottom:18px;">
                  <div style="width:23px;height:23px;line-height:23px;border-radius:12px;background-color:${color};color:#ffffff;font-size:12px;font-weight:700;text-align:center;">${n}</div>
                </td>
                <td valign="top" style="padding-bottom:18px;font-size:15px;line-height:1.6;color:#1f2937;">
                  ${html}
                </td>
              </tr>`

/** 灰色补充句 */
const muted = (s) => `<span style="color:#6b7280;">${s}</span>`

const shell = ({ subject, note, font, greeting, intro, ask, questions, closing, signOff, name, title, footer }) => `<!-- Subject: ${subject} -->
<!-- ${note} -->
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color:#f4f7f6;padding:28px 12px;font-family:${font};">
  <tr>
    <td align="center">
      <table role="presentation" width="560" cellpadding="0" cellspacing="0" border="0" style="max-width:560px;width:100%;background-color:#ffffff;border-radius:12px;overflow:hidden;border:1px solid #e3eae8;">

        <tr><td style="height:4px;background-color:${TEAL};font-size:0;line-height:0;">&nbsp;</td></tr>

        <tr>
          <td style="padding:26px 34px 18px 34px;border-bottom:1px solid #eef2f1;">
            <table role="presentation" cellpadding="0" cellspacing="0" border="0">
              <tr>
                <td valign="middle" style="padding-right:10px;">
                  <img src="https://www.pinzos.com/icon-192.png" width="34" height="34" alt="Pinzos" style="display:block;border:0;">
                </td>
                <td valign="middle">
                  <span style="font-size:19px;font-weight:700;color:#0f766e;letter-spacing:-0.2px;">Pinzos</span>
                </td>
              </tr>
            </table>
          </td>
        </tr>

        <tr>
          <td style="padding:28px 34px 8px 34px;">
            <p style="margin:0 0 18px 0;font-size:15px;line-height:1.65;color:#1f2937;">${greeting}</p>
            <p style="margin:0 0 14px 0;font-size:15px;line-height:1.65;color:#1f2937;">${intro}</p>
            <p style="margin:0 0 24px 0;font-size:15px;line-height:1.65;color:#1f2937;">${ask}</p>
          </td>
        </tr>

        <tr>
          <td style="padding:0 34px 6px 34px;">
            <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
${questions.map((q, i) => item(i + 1, q, i === 2 ? AMBER : TEAL)).join('\n')}
            </table>
          </td>
        </tr>

        <tr>
          <td style="padding:6px 34px 0 34px;">
            <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color:#f0fdfa;border-left:3px solid #2dd4bf;border-radius:0 6px 6px 0;">
              <tr>
                <td style="padding:13px 16px;font-size:14px;line-height:1.6;color:#115e59;">${closing}</td>
              </tr>
            </table>
          </td>
        </tr>

        <tr>
          <td style="padding:26px 34px 30px 34px;">
            <p style="margin:0 0 4px 0;font-size:15px;line-height:1.6;color:#1f2937;">${signOff}</p>
            <p style="margin:0;font-size:15px;line-height:1.5;color:#0f766e;font-weight:700;">${name}</p>
            <p style="margin:2px 0 0 0;font-size:13px;line-height:1.5;color:#6b7280;">${title}</p>
          </td>
        </tr>

        <tr>
          <td style="padding:16px 34px 22px 34px;border-top:1px solid #eef2f1;background-color:#fafcfb;">
            <p style="margin:0 0 3px 0;font-size:12px;line-height:1.6;color:#9ca3af;">${footer}</p>
            <p style="margin:0;font-size:12px;line-height:1.6;color:#9ca3af;">
              <a href="https://www.pinzos.com" style="color:#0d9488;text-decoration:none;">www.pinzos.com</a>
            </p>
          </td>
        </tr>

      </table>
    </td>
  </tr>
</table>
`

// ── 英文默认块 ────────────────────────────────────────────────────────────────
const EN = {
  font: FONT_LATIN,
  greeting: 'Dear [Name],',
  ask: 'It truly means a lot to us, and feedback from users like you is the most valuable input we get. If you have a moment, we would really appreciate your thoughts:',
  signOff: 'Warm regards,',
  name: 'Eden',
  title: 'Founder of Pinzos',
  footer: 'Pinzos — a new way to buy off-plan property in Dubai',
}

const Q1 = `Overall, how has the platform been for you so far? ${muted('Anything that felt confusing, or anything you feel is missing?')}`
const Q2 = `Is there something you'd like us to improve or build next?`

const VARIANTS = [
  {
    file: 'agent-trialing.html',
    subject: 'Thank you for using Pinzos!',
    note: '经纪 · 试用中 → Behyad / Rohit Achnoor / Monali Patil / 李加惠',
    ...EN,
    intro: 'Thank you for being one of our earliest users at Pinzos.',
    questions: [
      Q1,
      Q2,
      `Your free trial is coming to an end soon — is there anything that would make it worth continuing for you? ${muted("And if anything didn't work as expected, please do tell us.")}`,
    ],
    closing: 'Even a one-line reply would be a great help. Thank you again for your support.',
  },
  {
    file: 'agent-trial-ended.html',
    subject: 'Thank you for trying Pinzos!',
    note: '经纪 · 试用已结束 → Lei Zhu / lydia / Summer Tang / 13828783446 / Kermit Lee / leining988 / MM2334',
    ...EN,
    intro: 'Thank you for being one of our earliest users at Pinzos.',
    questions: [
      Q1,
      Q2,
      `I noticed your trial has come to an end — was there anything that made you decide not to continue? ${muted("An honest answer is genuinely welcome, and it helps us more than you'd think.")}`,
    ],
    closing: 'Even a one-line reply would be a great help. Thank you again for giving us a try.',
  },
  {
    file: 'developer.html',
    subject: 'Thank you for using Pinzos!',
    note: '开发商 → WW Grace / Jocelyn Wang / Linli Wang / Aileen Young / Olivia / Farzad Razzaghi',
    ...EN,
    intro: 'Thank you for being one of our earliest developer partners at Pinzos.',
    ask: 'It truly means a lot to us, and feedback from partners like you is the most valuable input we get. If you have a moment, we would really appreciate your thoughts:',
    questions: [
      `Overall, how has the platform been for you so far — especially when it comes to getting your projects in front of agents and buyers?`,
      `Is there something you'd like us to improve or build next for developers?`,
      `Was there anything that limited what you could do, or anything that didn't work the way you expected?`,
    ],
    closing: 'Even a one-line reply would be a great help. Thank you again for your support.',
  },
  {
    file: 'buyer.html',
    subject: 'Thank you for using Pinzos!',
    note: '买家 → tczhulei2001 / 刘民敏 / shuchang5681 / 澳房之吕 / 費南鹤 / Ying Hua',
    ...EN,
    intro: 'Thank you for being one of our earliest users at Pinzos.',
    questions: [
      Q1,
      `As someone looking at property in Dubai, what would help you most when making a decision?`,
      `Is there anything that stopped you from using it more often?`,
    ],
    closing: 'Even a one-line reply would be a great help. Thank you again for your support.',
  },
  {
    file: 'buyer-zh.html',
    subject: '感谢您使用 Pinzos！',
    note: '买家 · 中文版 → QQ / 163 邮箱的中文用户，回信率更高',
    font: FONT_CJK,
    greeting: '您好 [Name]，',
    intro: '非常感谢您成为 Pinzos 最早的一批用户。',
    ask: '您的使用对我们意义重大，而像您这样的用户反馈，是我们最宝贵的参考。如果方便的话，想请教您三个小问题：',
    questions: [
      `整体用下来感觉如何？${muted('有哪里让您觉得困惑，或者觉得缺了什么吗？')}`,
      `作为在迪拜看房的人，什么样的信息对您的决策帮助最大？`,
      `有没有什么原因让您没有更常使用它？`,
    ],
    closing: '哪怕只回一句话，对我们都是很大的帮助。再次感谢您的支持。',
    signOff: '顺祝安好，',
    name: 'Eden',
    title: 'Pinzos 创始人',
    footer: 'Pinzos — 迪拜期房购买新方式',
  },
  {
    file: 'unknown-role.html',
    subject: 'Thank you for trying Pinzos!',
    note: '未选角色 → Nicolloyd Dinham',
    ...EN,
    greeting: 'Dear Nicolloyd,',
    intro: 'Thank you for being one of our earliest users at Pinzos.',
    questions: [
      Q1,
      `May I ask what brought you to Pinzos — are you working in real estate, or looking at property yourself? ${muted('It helps us point you to the right things.')}`,
      `Was there anything that stopped you from using it more?`,
    ],
    closing: 'Even a one-line reply would be a great help. Thank you again for giving us a try.',
  },
]

for (const v of VARIANTS) {
  writeFileSync(join(OUT, v.file), shell(v), 'utf8')
  console.log('✓', v.file)
}
