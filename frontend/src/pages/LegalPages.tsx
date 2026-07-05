/**
 * Legal pages — /privacy & /terms.
 *
 * Required for Google OAuth brand verification (consent-screen links must
 * resolve on pinzos.com). Bilingual: follows the app language like AboutPage.
 * Plain, printable document style; publicly accessible, no login.
 */
import { Helmet } from 'react-helmet-async'
import { Link } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { ShieldCheck, FileText } from 'lucide-react'

const COMPANY = 'FINDHOMEGO AI TECH INC.'
// Routed via Cloudflare Email Routing → owner inbox. Keep in sync with the
// contact email on the Google OAuth consent screen.
const CONTACT_EMAIL = 'support@pinzos.com'

function useL() {
  const { i18n } = useTranslation()
  const zh = (i18n.language || 'en').startsWith('zh')
  return { zh, L: (cn: string, en: string) => (zh ? cn : en) }
}

function LegalShell({ icon, title, subtitle, canonical, children }: {
  icon: React.ReactNode; title: string; subtitle: string; canonical: string; children: React.ReactNode
}) {
  const { L } = useL()
  return (
    <div className="flex-1 overflow-y-auto bg-white text-slate-700">
      <Helmet>
        <title>{title} | Pinzos</title>
        <meta name="description" content={subtitle} />
        <link rel="canonical" href={canonical} />
      </Helmet>
      <div className="mx-auto max-w-3xl px-6 py-12 md:py-16">
        <div className="mb-2 flex items-center gap-3">
          <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-teal-50 text-teal-600">{icon}</span>
          <h1 className="text-3xl font-bold text-slate-900">{title}</h1>
        </div>
        <p className="text-sm text-slate-500">{subtitle}</p>
        <p className="mt-1 text-sm text-slate-400">{L('最后更新:2026年7月5日', 'Last updated: July 5, 2026')}</p>
        <div className="mt-8 space-y-8">{children}</div>
        <footer className="mt-12 border-t border-slate-200 pt-6 text-sm text-slate-500">
          <p>© {new Date().getFullYear()} {COMPANY} · Pinzos</p>
          <p className="mt-1 flex gap-4">
            <Link to="/privacy" className="text-teal-600 hover:underline">{L('隐私政策', 'Privacy Policy')}</Link>
            <Link to="/terms" className="text-teal-600 hover:underline">{L('服务条款', 'Terms of Service')}</Link>
            <Link to="/about" className="text-teal-600 hover:underline">{L('关于 Pinzos', 'About Pinzos')}</Link>
          </p>
        </footer>
      </div>
    </div>
  )
}

function Sec({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section>
      <h2 className="mb-2 text-lg font-semibold text-slate-900">{title}</h2>
      <div className="space-y-2 text-[15px] leading-relaxed">{children}</div>
    </section>
  )
}

function Ul({ items }: { items: React.ReactNode[] }) {
  return (
    <ul className="list-disc space-y-1.5 pl-5">
      {items.map((it, i) => <li key={i}>{it}</li>)}
    </ul>
  )
}

// ─────────────────────────────────────────────────────────────
// Privacy Policy — /privacy
// ─────────────────────────────────────────────────────────────
export function PrivacyPolicyPage() {
  const { L } = useL()
  return (
    <LegalShell
      icon={<ShieldCheck className="h-5 w-5" />}
      title={L('隐私政策', 'Privacy Policy')}
      subtitle={L('本政策说明 Pinzos 收集哪些信息、如何使用,以及你拥有的权利。', 'This policy explains what information Pinzos collects, how we use it, and the rights you have.')}
      canonical="https://www.pinzos.com/privacy"
    >
      <Sec title={L('1. 我们是谁', '1. Who we are')}>
        <p>{L(
          `Pinzos(pinzos.com)是一个探索迪拜房产的交互式平台,由加拿大不列颠哥伦比亚省注册公司 ${COMPANY} 运营。本政策适用于 pinzos.com 及其子域名上的所有服务。`,
          `Pinzos (pinzos.com) is an interactive platform for exploring Dubai property, operated by ${COMPANY}, a company registered in British Columbia, Canada. This policy covers all services on pinzos.com and its subdomains.`
        )}</p>
      </Sec>

      <Sec title={L('2. 我们收集的信息', '2. Information we collect')}>
        <Ul items={[
          L('账户信息:当你用 Google 登录或邮箱验证码登录时,我们收到你的姓名、邮箱地址和头像。我们不会看到也不会存储你的 Google 密码。',
            'Account information: when you sign in with Google or an email code, we receive your name, email address and profile picture. We never see or store your Google password.'),
          L('你主动提供的联系方式:当你请求经纪联系(例如留下电话或微信号)时,我们会记录这些信息以便为你安排跟进。',
            'Contact details you choose to share: if you ask to be contacted by an agent (e.g. leaving a phone or WeChat number), we record it so the follow-up can happen.'),
          L('使用数据:浏览的页面与项目、搜索、收藏、大致地理位置(由 IP 推断)、设备与浏览器类型。用于改进产品和为你服务的经纪了解你的偏好。',
            'Usage data: pages and projects viewed, searches, favorites, approximate location (inferred from IP), device and browser type. Used to improve the product and help the agent serving you understand your preferences.'),
          L('Luna 语音与文字对话:语音由 Google Gemini 实时处理;对话转录和查询记录会被保存,用于改进服务和便于你的经纪跟进。',
            'Luna voice and text conversations: audio is processed in real time by Google Gemini; transcripts and query records are stored to improve the service and enable agent follow-up.'),
          L('付款信息(仅经纪订阅):由 Stripe 处理,我们不存储你的银行卡号。',
            'Payment information (agent subscriptions only): handled by Stripe; we never store your card number.'),
        ]} />
      </Sec>

      <Sec title={L('3. 我们如何使用这些信息', '3. How we use it')}>
        <Ul items={[
          L('提供并改进平台功能(地图、数据分析、AI 助手)。', 'To provide and improve the platform (map, analytics, AI assistant).'),
          L('在你主动请求时,把你和为你服务的房产经纪对接。', 'To connect you with a real-estate agent when you request it.'),
          L('账单与订阅管理(经纪用户)。', 'Billing and subscription management (agent users).'),
          L('安全防护、防滥用与用量控制。', 'Security, abuse prevention and quota enforcement.'),
        ]} />
      </Sec>

      <Sec title={L('4. 何时共享', '4. When we share')}>
        <p>{L('我们不出售你的个人信息。仅在以下情形共享:', 'We do not sell your personal information. We share it only:')}</p>
        <Ul items={[
          L('与为你服务的房产经纪:当你留下联系方式、参加其发起的带看或导览时,你的联系方式与相关浏览偏好会提供给该经纪以便跟进。',
            'With the real-estate agent serving you: if you leave contact details or join a tour they host, your contact info and related browsing preferences are shared with that agent for follow-up.'),
          L('与下述第三方服务商,仅限提供服务所必需的范围。', 'With the service providers listed below, only as needed to run the service.'),
          L('法律要求时(如法院命令)。', 'When required by law (e.g. a court order).'),
        ]} />
      </Sec>

      <Sec title={L('5. 第三方服务', '5. Third-party services')}>
        <p>{L('平台依赖以下服务商,它们各自按其隐私政策处理数据:', 'The platform relies on these providers, each processing data under its own privacy policy:')}</p>
        <Ul items={[
          <span key="sb"><strong>Supabase</strong> — {L('账户认证与数据库', 'authentication and database')}</span>,
          <span key="gg"><strong>Google</strong> — {L('Google 登录;Gemini AI(Luna 语音/文字助手)', 'Google Sign-In; Gemini AI (the Luna voice/text assistant)')}</span>,
          <span key="st"><strong>Stripe</strong> — {L('订阅付款', 'subscription payments')}</span>,
          <span key="cf"><strong>Cloudflare</strong> — {L('网站托管与内容分发', 'hosting and content delivery')}</span>,
          <span key="hz"><strong>Hetzner</strong> — {L('服务器(德国)', 'servers (Germany)')}</span>,
          <span key="ag"><strong>Agora</strong> — {L('实时带看中的语音通话', 'voice calls during live tours')}</span>,
        ]} />
      </Sec>

      <Sec title={L('6. Cookie 与本地存储', '6. Cookies & local storage')}>
        <p>{L(
          '我们使用 Cookie 和浏览器本地存储来维持登录状态、记住语言等偏好,并用匿名访客标识做用量统计与限额。我们不做跨站广告追踪。',
          'We use cookies and browser local storage to keep you signed in, remember preferences like language, and maintain an anonymous visitor identifier for usage analytics and quotas. We do not do cross-site advertising tracking.'
        )}</p>
      </Sec>

      <Sec title={L('7. 数据保留与删除', '7. Retention & deletion')}>
        <p>{L(
          `账户存续期间我们保留上述数据。你可以随时发邮件到 ${CONTACT_EMAIL} 要求删除账户和个人数据;除法律或财务记录要求保留的部分外,我们会在 30 天内完成删除。`,
          `We keep the data above while your account is active. You can email ${CONTACT_EMAIL} at any time to request deletion of your account and personal data; we will complete it within 30 days, except records we must keep for legal or accounting reasons.`
        )}</p>
      </Sec>

      <Sec title={L('8. 数据安全与跨境传输', '8. Security & international transfers')}>
        <p>{L(
          '数据传输全程 TLS 加密,访问受权限控制。服务器位于欧盟(德国),部分服务商位于美国和加拿大;使用本平台即表示你知悉并同意此类跨境处理。',
          'All data is encrypted in transit (TLS) and access is permission-controlled. Servers are located in the EU (Germany); some providers operate in the US and Canada. By using the platform you consent to such cross-border processing.'
        )}</p>
      </Sec>

      <Sec title={L('9. 未成年人', '9. Children')}>
        <p>{L('本平台面向房产买家与从业者,不面向 18 岁以下人士。', 'The platform is intended for property buyers and professionals, not for anyone under 18.')}</p>
      </Sec>

      <Sec title={L('10. 政策变更', '10. Changes')}>
        <p>{L('政策更新会发布在本页面;重大变更会在站内提示。', 'Updates will be posted on this page; material changes will be announced in the app.')}</p>
      </Sec>

      <Sec title={L('11. 联系我们', '11. Contact')}>
        <p>{COMPANY} · <a href={`mailto:${CONTACT_EMAIL}`} className="text-teal-600 hover:underline">{CONTACT_EMAIL}</a></p>
      </Sec>
    </LegalShell>
  )
}

// ─────────────────────────────────────────────────────────────
// Terms of Service — /terms
// ─────────────────────────────────────────────────────────────
export function TermsPage() {
  const { L } = useL()
  return (
    <LegalShell
      icon={<FileText className="h-5 w-5" />}
      title={L('服务条款', 'Terms of Service')}
      subtitle={L('使用 Pinzos 即表示你同意以下条款。', 'By using Pinzos you agree to these terms.')}
      canonical="https://www.pinzos.com/terms"
    >
      <Sec title={L('1. 接受条款', '1. Acceptance')}>
        <p>{L(
          `Pinzos(pinzos.com)由 ${COMPANY}(加拿大不列颠哥伦比亚省)运营。访问或使用本平台即表示你同意本条款;不同意请停止使用。`,
          `Pinzos (pinzos.com) is operated by ${COMPANY} (British Columbia, Canada). By accessing or using the platform you agree to these terms; if you do not agree, please stop using it.`
        )}</p>
      </Sec>

      <Sec title={L('2. 服务说明', '2. The service')}>
        <p>{L(
          'Pinzos 提供迪拜房产信息的交互式地图与分析工具,数据来源包括迪拜土地局(DLD)公开记录、开发商资料及第三方数据源,并提供 AI 助手、导览与面向经纪的工具。',
          'Pinzos provides an interactive map and analytics for Dubai property, drawing on Dubai Land Department (DLD) public records, developer materials and third-party sources, plus AI assistants, guided tours and tools for agents.'
        )}</p>
      </Sec>

      <Sec title={L('3. 重要:不构成投资建议', '3. Important: not investment advice')}>
        <Ul items={[
          L('平台上的价格、成交、租金、回报等数据按“现状”提供,可能存在延迟、缺失或错误。',
            'Prices, transactions, rents, returns and other data are provided “as is” and may be delayed, incomplete or contain errors.'),
          L('所有内容(含 AI 生成的回答与分析)仅供参考,不构成投资、法律、税务或财务建议。',
            'Nothing on the platform (including AI-generated answers and analysis) constitutes investment, legal, tax or financial advice.'),
          L('购房决策前请独立核实信息并咨询持牌专业人士。AI 回答可能不准确。',
            'Verify information independently and consult licensed professionals before any purchase decision. AI answers can be inaccurate.'),
        ]} />
      </Sec>

      <Sec title={L('4. 账户', '4. Accounts')}>
        <p>{L(
          '注册需提供真实信息并妥善保管账户。发现滥用、欺诈或违反本条款的行为,我们可以暂停或终止账户。',
          'You must provide accurate information and keep your account secure. We may suspend or terminate accounts involved in abuse, fraud or violations of these terms.'
        )}</p>
      </Sec>

      <Sec title={L('5. 可接受使用', '5. Acceptable use')}>
        <p>{L('你不得:', 'You must not:')}</p>
        <Ul items={[
          L('抓取、批量导出或转售平台数据(含地图区域边界、成交与租约数据、AI 输出)。',
            'Scrape, bulk-export or resell platform data (including map area boundaries, transaction/rental data and AI outputs).'),
          L('逆向工程、干扰服务运行,或规避用量限制与计费。',
            'Reverse-engineer or disrupt the service, or circumvent usage limits and billing.'),
          L('将平台用于违法用途,或将 AI 输出冒充为官方或专业意见。',
            'Use the platform for unlawful purposes, or present AI output as official or professional advice.'),
        ]} />
      </Sec>

      <Sec title={L('6. 订阅与付款(经纪)', '6. Subscriptions & payment (agents)')}>
        <Ul items={[
          L('经纪订阅由 Stripe 处理,按月或按年自动续费;可随时取消,取消于当前计费周期结束时生效。',
            'Agent subscriptions are processed by Stripe and renew automatically monthly or yearly; you can cancel anytime, effective at the end of the current billing period.'),
          L('免费试用期内取消不产生费用。价格调整会提前通知,不溯及已付周期。',
            'Cancelling within a free trial incurs no charge. Price changes will be notified in advance and never apply retroactively.'),
        ]} />
      </Sec>

      <Sec title={L('7. 知识产权', '7. Intellectual property')}>
        <p>{L(
          '平台的软件、设计、报告模板及整理加工后的数据(包括手工绘制的区域边界)归我们或许可方所有;你获得的是不可转让的个人使用许可。开发商楼书及其素材归其权利人所有。',
          'The platform software, design, report templates and curated data (including hand-drawn area boundaries) belong to us or our licensors; you receive a non-transferable personal licence to use them. Developer brochures and their assets belong to their owners.'
        )}</p>
      </Sec>

      <Sec title={L('8. 经纪上传的内容', '8. Content uploaded by agents')}>
        <p>{L(
          '经纪与开发商用户须保证对其上传的资料(楼书、图片、报价等)拥有合法使用权;我们可以移除涉嫌侵权的内容。',
          'Agent and developer users must have the legal right to any material they upload (brochures, images, quotes); we may remove content suspected of infringement.'
        )}</p>
      </Sec>

      <Sec title={L('9. 免责声明与责任限制', '9. Disclaimer & limitation of liability')}>
        <p>{L(
          '在法律允许的最大范围内:平台按“现状”提供,不作任何明示或默示保证;我们不对间接损失、利润损失或数据损失负责;我们的全部责任以你过去 12 个月向我们支付的费用为上限(免费用户为 100 美元)。',
          'To the maximum extent permitted by law: the platform is provided “as is” without warranties of any kind; we are not liable for indirect damages, lost profits or lost data; our total liability is capped at the fees you paid us in the past 12 months (USD 100 for free users).'
        )}</p>
      </Sec>

      <Sec title={L('10. 适用法律', '10. Governing law')}>
        <p>{L(
          '本条款受加拿大不列颠哥伦比亚省法律管辖,争议由该省法院专属管辖。',
          'These terms are governed by the laws of British Columbia, Canada, and disputes fall under the exclusive jurisdiction of its courts.'
        )}</p>
      </Sec>

      <Sec title={L('11. 条款变更与联系', '11. Changes & contact')}>
        <p>{L(
          `条款更新会发布在本页面,重大变更会在站内提示。问题请联系 ${CONTACT_EMAIL}。`,
          `Updates will be posted on this page; material changes will be announced in the app. Questions: ${CONTACT_EMAIL}.`
        )}</p>
      </Sec>
    </LegalShell>
  )
}
