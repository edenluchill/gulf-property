/**
 * Luna Tour — opening greeting (click-to-start).
 *
 * A beautiful personalized cover shown before playback: agent badge, the
 * client's name, a breathing Luna orb, and a big start button. The tap is what
 * unlocks browser audio, so the tour begins with sound on. Decoupled component;
 * delete it + its use in TourOverlay to remove.
 */
interface GreetingScreenProps {
  agentName: string
  agentPhoto?: string
  agentTitle: string
  clientName?: string
  propertyCount: number
  accent: string
  onStart: () => void
}

export default function GreetingScreen({
  agentName,
  agentPhoto,
  agentTitle,
  clientName,
  propertyCount,
  accent,
  onStart,
}: GreetingScreenProps) {
  return (
    <div className="lt-greet" style={{ ['--lt-accent' as string]: accent }}>
      <div className="lt-greet-glow" />
      <div className="lt-greet-inner">
        <div className="lt-greet-orb" />

        <div className="lt-greet-agent">
          {agentPhoto && <img src={agentPhoto} alt={agentName} />}
          <div>
            <div className="lt-greet-agent-name">{agentName}</div>
            <div className="lt-greet-agent-title">{agentTitle}</div>
          </div>
        </div>

        <h1 className="lt-greet-title">
          {clientName ? `${clientName}，欢迎` : '欢迎'}
        </h1>
        <p className="lt-greet-sub">
          {agentName} 为{clientName ? '你' : '你'}精选了 {propertyCount} 个家 · Luna 带你看
        </p>

        <button className="lt-greet-btn" onClick={onStart}>
          <span className="lt-greet-btn-icon">▶</span>
          开始 · 约 3 分钟
        </button>
        <div className="lt-greet-hint">轻触屏幕可随时暂停提问</div>
      </div>
    </div>
  )
}
