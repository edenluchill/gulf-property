/**
 * 经纪联系买家的**现成模板** —— 主题 + 正文,按**买家的**语言生成。
 *
 * 起因(2026-08-09):派单通知发出去后,一个经纪自己给买家写了一封
 * **没有主题、只有一句话、默认中文**的邮件("你好,我在pinzos上看到您的留言")。
 * 买家如果是英语/俄语/阿语的,那封信基本等于没发;就算是中文买家,那也不像个专业顾问。
 *
 * 所以我们**不替他发信**(owner:「不用帮他发邮件 给他准备模板就好」)——
 * 只把写好的主题和正文摆在他面前,他复制/一键打开邮件客户端,用自己的地址发。
 * 这样署名、回信地址、后续往来都在他手里,我们不夹在中间。
 *
 * 语言规则(owner 定的):**默认英文,买家界面明确是别的语言才用那种**。
 * 迪拜是国际市场,英文是安全默认值;中文只在买家真的在用中文界面时才用。
 */

export type OutreachLang = 'en' | 'zh' | 'fr' | 'ru' | 'ar'

/** i18n 语言码 → 模板语言。**认不出一律回落英文**,不猜。 */
export function outreachLang(raw?: string | null): OutreachLang {
  const l = (raw || '').toLowerCase()
  if (l.startsWith('zh')) return 'zh'
  if (l.startsWith('fr')) return 'fr'
  if (l.startsWith('ru')) return 'ru'
  if (l.startsWith('ar')) return 'ar'
  return 'en'
}

export interface OutreachInput {
  agentName?: string | null
  agentTitle?: string | null
  brokerage?: string | null
  projectName?: string | null
  buyerNote?: string | null
}

export interface Outreach { subject: string; body: string }

/**
 * ⚠️ 模板里**不写任何我们没有的事实** —— 不提"我看了你的预算/你收藏的房源",
 *    也不替经纪承诺回复时限。买家留言原样引用,其余全是中性措辞。
 *    编出来的细节一旦对不上,第一句话就把信任毁了。
 */
export function buildOutreach(lang: OutreachLang, i: OutreachInput): Outreach {
  const agent = (i.agentName || '').trim()
  /**
   * 头衔是经纪**自己手写的自由文本**,语言未知。直接拼进模板会写出
   * "I am Alice Shi, 置业顾问, and I will be assisting you." 这种半中半英的句子 ——
   * 而这封信是给买家看的第一印象。
   *
   * 判据只看字符集,不猜语义:中日韩字符只在中文模板里留,阿拉伯字符只在阿语模板里留,
   * 其余情况**宁可不写**。少一个头衔不会怎样,一句混着两种文字的话会。
   */
  const titleFits = (txt?: string | null) => {
    const s = (txt || '').trim()
    if (!s) return false
    if (/[一-鿿぀-ヿ]/.test(s)) return lang === 'zh'
    if (/[؀-ۿ]/.test(s)) return lang === 'ar'
    return true   // 拉丁字母的头衔("Senior Consultant")五种语言里都不违和
  }
  const who = [titleFits(i.agentTitle) ? i.agentTitle : null, i.brokerage].filter(Boolean).join(' · ')
  const proj = (i.projectName || '').trim()
  const note = (i.buyerNote || '').trim()

  const T: Record<OutreachLang, Outreach> = {
    en: {
      subject: proj ? `Your enquiry about ${proj} — Pinzos` : 'Your enquiry on Pinzos',
      body: [
        'Hello,',
        '',
        proj
          ? `Thank you for your enquiry about ${proj} on Pinzos. I am ${agent}${who ? `, ${who}` : ''}, and I will be assisting you.`
          : `Thank you for your enquiry on Pinzos. I am ${agent}${who ? `, ${who}` : ''}, and I will be assisting you.`,
        ...(note ? ['', `You wrote: "${note}"`] : []),
        '',
        'To point you in the right direction, could you share:',
        '  • Your budget range',
        '  • Whether this is for investment or to live in',
        '  • When you would like to view',
        '',
        'I can send you recent comparable transactions, the payment plan, and available units. Happy to arrange a viewing — in person or online.',
        '',
        'Best regards,',
        agent,
        who,
      ].filter((x) => x !== undefined).join('\n'),
    },
    zh: {
      subject: proj ? `关于 ${proj} 的咨询 — Pinzos` : '您在 Pinzos 的咨询',
      body: [
        '您好,',
        '',
        proj
          ? `感谢您在 Pinzos 上咨询 ${proj}。我是 ${agent}${who ? `,${who}` : ''},接下来由我为您服务。`
          : `感谢您在 Pinzos 上的咨询。我是 ${agent}${who ? `,${who}` : ''},接下来由我为您服务。`,
        ...(note ? ['', `您的留言:「${note}」`] : []),
        '',
        '为了给您更有针对性的建议,方便告诉我:',
        '  • 预算区间',
        '  • 是投资还是自住',
        '  • 大概什么时候方便看房',
        '',
        '我可以先发您这个项目的近期成交对比、付款计划和在售户型。看房可以线下,也可以线上带看。',
        '',
        '顺祝安好,',
        agent,
        who,
      ].filter((x) => x !== undefined).join('\n'),
    },
    fr: {
      subject: proj ? `Votre demande concernant ${proj} — Pinzos` : 'Votre demande sur Pinzos',
      body: [
        'Bonjour,',
        '',
        proj
          ? `Merci pour votre demande concernant ${proj} sur Pinzos. Je suis ${agent}${who ? `, ${who}` : ''}, et je vais vous accompagner.`
          : `Merci pour votre demande sur Pinzos. Je suis ${agent}${who ? `, ${who}` : ''}, et je vais vous accompagner.`,
        ...(note ? ['', `Votre message : « ${note} »`] : []),
        '',
        'Pour mieux vous orienter, pourriez-vous me préciser :',
        '  • Votre budget',
        '  • Investissement ou résidence principale',
        '  • Quand vous souhaitez visiter',
        '',
        'Je peux vous envoyer les transactions comparables récentes, le plan de paiement et les unités disponibles. Visite possible sur place ou en ligne.',
        '',
        'Cordialement,',
        agent,
        who,
      ].filter((x) => x !== undefined).join('\n'),
    },
    ru: {
      subject: proj ? `Ваш запрос по проекту ${proj} — Pinzos` : 'Ваш запрос на Pinzos',
      body: [
        'Здравствуйте,',
        '',
        proj
          ? `Благодарю за запрос по проекту ${proj} на Pinzos. Меня зовут ${agent}${who ? `, ${who}` : ''}, я буду вести ваш запрос.`
          : `Благодарю за ваш запрос на Pinzos. Меня зовут ${agent}${who ? `, ${who}` : ''}, я буду вести ваш запрос.`,
        ...(note ? ['', `Ваше сообщение: «${note}»`] : []),
        '',
        'Чтобы подобрать точнее, подскажите, пожалуйста:',
        '  • Ваш бюджет',
        '  • Инвестиция или для проживания',
        '  • Когда вам удобно на просмотр',
        '',
        'Могу прислать недавние сопоставимые сделки, план оплаты и доступные планировки. Просмотр — очно или онлайн.',
        '',
        'С уважением,',
        agent,
        who,
      ].filter((x) => x !== undefined).join('\n'),
    },
    ar: {
      subject: proj ? `استفسارك عن ${proj} — Pinzos` : 'استفسارك على Pinzos',
      body: [
        'مرحبًا،',
        '',
        proj
          ? `شكرًا لاستفسارك عن ${proj} عبر Pinzos. أنا ${agent}${who ? `، ${who}` : ''}، وسأكون في خدمتك.`
          : `شكرًا لاستفسارك عبر Pinzos. أنا ${agent}${who ? `، ${who}` : ''}، وسأكون في خدمتك.`,
        ...(note ? ['', `رسالتك: «${note}»`] : []),
        '',
        'لأقدّم لك اقتراحًا أدق، هل يمكنك إخباري بـ:',
        '  • نطاق ميزانيتك',
        '  • للاستثمار أم للسكن',
        '  • الموعد المناسب للمعاينة',
        '',
        'يمكنني إرسال صفقات مماثلة حديثة، وخطة السداد، والوحدات المتاحة. والمعاينة ممكنة حضوريًا أو عبر الإنترنت.',
        '',
        'مع خالص التقدير،',
        agent,
        who,
      ].filter((x) => x !== undefined).join('\n'),
    },
  }
  const out = T[lang]
  // 末尾的 agent/who 可能是空字符串 —— 去掉尾部空行,免得签名底下挂两行空白
  return { subject: out.subject, body: out.body.replace(/\n+$/, '') }
}
