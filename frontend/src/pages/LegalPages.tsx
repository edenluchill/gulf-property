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

// Brand-only by owner decision (2026-07-06): no corporate entity named anywhere
// in these pages — "Pinzos" is the contracting name throughout. Trade-off
// accepted: the liability-cap clauses shield an unnamed operator.
// Routed via Cloudflare Email Routing → owner inbox. Keep in sync with the
// contact email on the Google OAuth consent screen.
const CONTACT_EMAIL = 'support@pinzos.com'

function useL() {
  const { t: tRaw } = useTranslation('misc')
  return { t: tRaw as (k: string, o?: Record<string, unknown>) => string }
}

function LegalShell({ icon, title, subtitle, canonical, children }: {
  icon: React.ReactNode; title: string; subtitle: string; canonical: string; children: React.ReactNode
}) {
  const { t } = useL()
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
        <p className="mt-1 text-sm text-slate-400">{t('misc:lastUpdatedJuly5')}</p>
        <div className="mt-8 space-y-8">{children}</div>
        <footer className="mt-12 border-t border-slate-200 pt-6 text-sm text-slate-500">
          <p>© {new Date().getFullYear()} Pinzos</p>
          <p className="mt-1 flex gap-4">
            <Link to="/privacy" className="text-teal-600 hover:underline">{t('misc:privacyPolicy')}</Link>
            <Link to="/terms" className="text-teal-600 hover:underline">{t('misc:termsOfService')}</Link>
            <Link to="/about" className="text-teal-600 hover:underline">{t('misc:aboutPinzos')}</Link>
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
  const { t } = useL()
  return (
    <LegalShell
      icon={<ShieldCheck className="h-5 w-5" />}
      title={t('misc:privacyPolicy2')}
      subtitle={t('misc:thisPolicyExplainsWhat')}
      canonical="https://www.pinzos.com/privacy"
    >
      <Sec title={t('misc:1WhoWeAre')}>
        <p>{t('misc:pinzosPinzosComWe')}</p>
      </Sec>

      <Sec title={t('misc:2InformationWeCollect')}>
        <Ul items={[
          t('misc:accountInformationWhenYou'),
          t('misc:contactDetailsYouChoose'),
          t('misc:usageDataPagesAnd'),
          t('misc:lunaVoiceAndText'),
          t('misc:paymentInformationAgentSubscriptions'),
        ]} />
      </Sec>

      <Sec title={t('misc:3HowWeUse')}>
        <Ul items={[
          t('misc:toProvideAndImprove'),
          t('misc:toConnectYouWith'),
          t('misc:billingAndSubscriptionManagement'),
          t('misc:securityAbusePreventionAnd'),
        ]} />
      </Sec>

      <Sec title={t('misc:4WhenWeShare')}>
        <p>{t('misc:weDoNotSell')}</p>
        <Ul items={[
          t('misc:withTheRealEstate'),
          t('misc:withTheServiceProviders'),
          t('misc:whenRequiredByLaw'),
        ]} />
      </Sec>

      <Sec title={t('misc:5ThirdPartyServices')}>
        <p>{t('misc:thePlatformReliesOn')}</p>
        <Ul items={[
          <span key="sb"><strong>Supabase</strong> — {t('misc:authenticationAndDatabase')}</span>,
          <span key="gg"><strong>Google</strong> — {t('misc:googleSignInGemini')}</span>,
          <span key="st"><strong>Stripe</strong> — {t('misc:subscriptionPayments')}</span>,
          <span key="cf"><strong>Cloudflare</strong> — {t('misc:hostingAndContentDelivery')}</span>,
          <span key="hz"><strong>Hetzner</strong> — {t('misc:serversGermany')}</span>,
          <span key="ag"><strong>Agora</strong> — {t('misc:voiceCallsDuringLive')}</span>,
        ]} />
      </Sec>

      <Sec title={t('misc:6CookiesLocalStorage')}>
        <p>{t('misc:weUseCookiesAnd')}</p>
      </Sec>

      <Sec title={t('misc:7RetentionDeletion')}>
        <p>{t('misc:weKeepTheData', { CONTACT_EMAIL })}</p>
      </Sec>

      <Sec title={t('misc:8SecurityInternationalTransfers')}>
        <p>{t('misc:allDataIsEncrypted')}</p>
      </Sec>

      <Sec title={t('misc:9Children')}>
        <p>{t('misc:thePlatformIsIntended')}</p>
      </Sec>

      <Sec title={t('misc:10Changes')}>
        <p>{t('misc:updatesWillBePosted')}</p>
      </Sec>

      <Sec title={t('misc:11Contact')}>
        <p>Pinzos · <a href={`mailto:${CONTACT_EMAIL}`} className="text-teal-600 hover:underline">{CONTACT_EMAIL}</a></p>
      </Sec>
    </LegalShell>
  )
}

// ─────────────────────────────────────────────────────────────
// Terms of Service — /terms
// ─────────────────────────────────────────────────────────────
export function TermsPage() {
  const { t } = useL()
  return (
    <LegalShell
      icon={<FileText className="h-5 w-5" />}
      title={t('misc:termsOfService2')}
      subtitle={t('misc:byUsingPinzosYou')}
      canonical="https://www.pinzos.com/terms"
    >
      <Sec title={t('misc:1Acceptance')}>
        <p>{t('misc:theseTermsGovernYour')}</p>
      </Sec>

      <Sec title={t('misc:2TheService')}>
        <p>{t('misc:pinzosProvidesAnInteractive')}</p>
      </Sec>

      <Sec title={t('misc:3ImportantNotInvestment')}>
        <Ul items={[
          t('misc:pricesTransactionsRentsReturns'),
          t('misc:nothingOnThePlatform'),
          t('misc:verifyInformationIndependentlyAnd'),
        ]} />
      </Sec>

      <Sec title={t('misc:4Accounts')}>
        <p>{t('misc:youMustProvideAccurate')}</p>
      </Sec>

      <Sec title={t('misc:5AcceptableUse')}>
        <p>{t('misc:youMustNot')}</p>
        <Ul items={[
          t('misc:scrapeBulkExportOr'),
          t('misc:reverseEngineerOrDisrupt'),
          t('misc:useThePlatformFor'),
        ]} />
      </Sec>

      <Sec title={t('misc:6SubscriptionsPaymentAgents')}>
        <Ul items={[
          t('misc:agentSubscriptionsAreProcessed'),
          t('misc:cancellingWithinAFree'),
        ]} />
      </Sec>

      <Sec title={t('misc:7IntellectualProperty')}>
        <p>{t('misc:thePlatformSoftwareDesign')}</p>
      </Sec>

      <Sec title={t('misc:8ContentUploadedBy')}>
        <p>{t('misc:agentAndDeveloperUsers')}</p>
      </Sec>

      <Sec title={t('misc:9DisclaimerLimitationOf')}>
        <p>{t('misc:toTheMaximumExtent')}</p>
      </Sec>

      <Sec title={t('misc:10GoverningLaw')}>
        <p>{t('misc:theseTermsAreGoverned')}</p>
      </Sec>

      <Sec title={t('misc:11ChangesContact')}>
        <p>{t('misc:updatesWillBePosted2', { CONTACT_EMAIL })}</p>
      </Sec>
    </LegalShell>
  )
}
