/**
 * Luna Tour — visual storyboard EDITOR (dedicated view, route /agent/tour/:id/edit).
 *
 * A left→right timeline of nodes (开场 → each stop's beats → 结尾) connected by
 * lines, with inter-stop transition markers. Click a node to edit it in the side
 * panel: narration, AI comment, cards (timing/remove), media. Stop-level reorder /
 * delete / add-place. Reuses every agent edit endpoint via lunaFetch.
 */
import { useCallback, useEffect, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { lunaFetch } from '../lunaApi'

interface Node {
  id: string
  group: string
  kind: string
  narration: string
  seconds?: number
  camera?: string[]
  overlays?: { idx: number; type: string; label: string; at: number; dur: number }[]
  transition?: string
  actIndex?: number
  isPlace?: boolean
}
interface Group {
  actIndex: number
  name: string
  isPlace: boolean
  nodes: Node[]
}

const KIND_ZH: Record<string, string> = { intro: '开场', arrival: '到达', life: '生活', numbers: '数字', outro: '结尾', beat: '段落' }

function groupNodes(nodes: Node[]): Group[] {
  const groups: Group[] = []
  for (const n of nodes) {
    const ai = n.actIndex ?? -1
    const last = groups[groups.length - 1]
    if (!last || last.actIndex !== ai || (ai === -1 && last.name !== n.group)) {
      groups.push({ actIndex: ai, name: n.group, isPlace: !!n.isPlace, nodes: [n] })
    } else {
      last.nodes.push(n)
    }
  }
  return groups
}

export default function TourEditor() {
  const { id = '' } = useParams<{ id: string }>()
  const [title, setTitle] = useState('')
  const [nodes, setNodes] = useState<Node[]>([])
  const [loading, setLoading] = useState(true)
  const [selId, setSelId] = useState<string | null>(null)
  const [comments, setComments] = useState<Record<string, string>>({})
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState('')
  // add-place
  const [placeQ, setPlaceQ] = useState('')
  const [placeResults, setPlaceResults] = useState<{ name: string; category: string; lng: number; lat: number }[]>([])
  // media composer
  const [mediaUrl, setMediaUrl] = useState('')
  const [mediaCap, setMediaCap] = useState('')
  const [mediaBusy, setMediaBusy] = useState(false)

  const reload = useCallback(async () => {
    const r = await lunaFetch(`/sessions/${id}/script`)
    const d = await r.json()
    setTitle(d.title || '')
    setNodes(d.flow || [])
  }, [id])

  useEffect(() => {
    ;(async () => {
      setLoading(true)
      try {
        await reload()
      } catch {
        /* ignore */
      }
      setLoading(false)
    })()
  }, [reload])

  useEffect(() => {
    const q = placeQ.trim()
    if (q.length < 2) return setPlaceResults([])
    const t = setTimeout(async () => {
      try {
        const r = await lunaFetch(`/place-search?q=${encodeURIComponent(q)}`)
        if (r.ok) setPlaceResults((await r.json()).places || [])
      } catch {
        /* ignore */
      }
    }, 250)
    return () => clearTimeout(t)
  }, [placeQ])

  const sel = nodes.find((n) => n.id === selId) || null
  const groups = groupNodes(nodes)

  const flash = (m: string) => {
    setMsg(m)
    setTimeout(() => setMsg(''), 2500)
  }

  const saveNarration = async () => {
    setBusy(true)
    try {
      const narration: Record<string, string> = {}
      for (const n of nodes) narration[n.id] = n.narration
      const r = await lunaFetch(`/sessions/${id}`, { method: 'PATCH', body: JSON.stringify({ title, narration }) })
      flash(r.ok ? '✅ 已保存' : '❌ 保存失败')
    } catch {
      flash('❌ 网络错误')
    }
    setBusy(false)
  }

  const applyComments = async () => {
    const entries = Object.entries(comments).filter(([, v]) => v.trim())
    if (!entries.length) return flash('先在某个节点写一句给 AI 的意见')
    setBusy(true)
    try {
      await Promise.all(
        entries.map(([beat_id, body]) =>
          lunaFetch(`/sessions/${id}/comments`, { method: 'POST', body: JSON.stringify({ beat_id, body: body.trim() }) })
        )
      )
      const r = await lunaFetch(`/sessions/${id}/revise`, { method: 'POST' })
      const d = await r.json()
      if (d.applied) {
        setComments({})
        await reload()
        flash(`✅ AI 改了 ${d.applied} 段(语音后台重生成)`)
      } else flash(`ℹ️ ${d.message || 'AI 未产生改动'}`)
    } catch {
      flash('❌ 改稿失败')
    }
    setBusy(false)
  }

  const editOverlays = async (beatId: string, edits: { index: number; duration_ms?: number; remove?: boolean }[]) => {
    const r = await lunaFetch(`/sessions/${id}/beat-overlays`, { method: 'POST', body: JSON.stringify({ beat_id: beatId, edits }) })
    if (r.ok) {
      const d = await r.json()
      setNodes((cur) => cur.map((n) => (n.id === beatId ? { ...n, overlays: d.overlays } : n)))
    }
  }
  const addMedia = async (beatId: string, opts: { url?: string; file?: File }) => {
    setMediaBusy(true)
    try {
      let url = opts.url?.trim()
      let kind = 'video'
      if (opts.file) {
        const fd = new FormData()
        fd.append('file', opts.file)
        const up = await lunaFetch(`/media-upload`, { method: 'POST', body: fd })
        const ud = await up.json()
        if (!up.ok || !ud.url) {
          flash(ud.error || '上传失败')
          setMediaBusy(false)
          return
        }
        url = ud.url
        kind = ud.media_kind
      } else if (url) {
        kind = /\.(jpg|jpeg|png|webp|gif)(\?|$)/i.test(url) ? 'image' : 'video'
      }
      if (!url) return
      const r = await lunaFetch(`/sessions/${id}/beat-media`, {
        method: 'POST',
        body: JSON.stringify({ beat_id: beatId, media_kind: kind, url, caption: mediaCap.trim() || undefined }),
      })
      if (r.ok) {
        const d = await r.json()
        setNodes((cur) => cur.map((n) => (n.id === beatId ? { ...n, overlays: d.overlays } : n)))
        setMediaUrl('')
        setMediaCap('')
        flash('✅ 已加入媒体')
      }
    } catch {
      flash('❌ 媒体失败')
    }
    setMediaBusy(false)
  }
  const moveStop = async (actIndex: number, dir: -1 | 1) => {
    const r = await lunaFetch(`/sessions/${id}/move-stop`, { method: 'POST', body: JSON.stringify({ act_index: actIndex, dir }) })
    if (r.ok) await reload()
  }
  const deleteStop = async (actIndex: number, name: string) => {
    if (!window.confirm(`删除停靠点「${name}」?(可在版本里回滚)`)) return
    const r = await lunaFetch(`/sessions/${id}/delete-stop`, { method: 'POST', body: JSON.stringify({ act_index: actIndex }) })
    if (r.ok) {
      setSelId(null)
      await reload()
    }
  }
  const addStop = async (p: { name: string; lng: number; lat: number }) => {
    setBusy(true)
    const r = await lunaFetch(`/sessions/${id}/add-stop`, { method: 'POST', body: JSON.stringify(p) })
    if (r.ok) {
      setPlaceQ('')
      setPlaceResults([])
      await reload()
      flash(`✅ 已加入「${p.name}」`)
    }
    setBusy(false)
  }

  if (loading) return <div className="p-8 text-slate-400">加载编辑器…</div>

  return (
    <div className="flex flex-col h-screen bg-slate-50">
      {/* top bar */}
      <div className="flex items-center gap-3 px-4 py-2.5 border-b bg-white shrink-0">
        <Link to="/agent/tour" className="text-slate-500 hover:text-slate-800 text-sm">← 返回</Link>
        <input
          className="flex-1 border rounded-lg px-3 py-1.5 text-sm font-medium"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
        />
        <button onClick={applyComments} disabled={busy} className="bg-indigo-500 text-white rounded-lg px-3 py-1.5 text-sm disabled:opacity-50">✨ 用 AI 应用评论</button>
        <button onClick={saveNarration} disabled={busy} className="bg-emerald-500 text-white rounded-lg px-3 py-1.5 text-sm disabled:opacity-50">保存</button>
        {msg && <span className="text-sm">{msg}</span>}
      </div>

      <div className="flex-1 flex min-h-0">
        {/* timeline (horizontal) */}
        <div className="flex-1 overflow-x-auto overflow-y-hidden p-6">
          <div className="flex items-stretch gap-0 h-full" style={{ minHeight: 280 }}>
            {groups.map((g, gi) => (
              <div key={gi} className="flex items-stretch">
                {/* inter-stop transition connector */}
                {gi > 0 && (
                  <div className="flex flex-col items-center justify-center px-2 self-center">
                    <div className="text-[10px] text-indigo-400 whitespace-nowrap mb-1">{g.nodes[0]?.transition || ''}</div>
                    <div className="w-10 h-0.5 bg-indigo-200" />
                    <div className="text-indigo-300 text-lg leading-none">→</div>
                  </div>
                )}
                {/* stop column */}
                <div className={`rounded-xl border ${g.actIndex >= 0 ? 'border-emerald-200 bg-emerald-50/40' : 'border-slate-200 bg-white'} p-2`}>
                  <div className="flex items-center gap-1 mb-1.5 px-1">
                    <span className="text-xs font-semibold text-slate-700 truncate max-w-[160px]">
                      {g.isPlace ? '📍 ' : ''}{g.name}
                    </span>
                    {g.actIndex >= 0 && (
                      <span className="flex items-center gap-0.5 ml-auto">
                        <button className="text-slate-400 hover:text-slate-700 px-1 text-xs" title="左移" onClick={() => moveStop(g.actIndex, -1)}>←</button>
                        <button className="text-slate-400 hover:text-slate-700 px-1 text-xs" title="右移" onClick={() => moveStop(g.actIndex, 1)}>→</button>
                        <button className="text-rose-300 hover:text-rose-600 px-1 text-xs" title="删除停靠点" onClick={() => deleteStop(g.actIndex, g.name)}>✕</button>
                      </span>
                    )}
                  </div>
                  <div className="flex items-stretch gap-2">
                    {g.nodes.map((n, ni) => (
                      <div key={n.id} className="flex items-center">
                        {ni > 0 && <div className="w-4 h-0.5 bg-slate-200" />}
                        <button
                          onClick={() => setSelId(n.id)}
                          className={`w-44 text-left rounded-lg border p-2 bg-white transition ${selId === n.id ? 'border-indigo-500 ring-2 ring-indigo-200' : 'border-slate-200 hover:border-slate-300'}`}
                        >
                          <div className="flex items-center gap-1 mb-1">
                            <span className="text-[10px] bg-slate-100 text-slate-500 rounded px-1.5 py-0.5">{KIND_ZH[n.kind] || n.kind}</span>
                            {n.seconds ? <span className="text-[10px] text-slate-400 ml-auto">~{n.seconds}s</span> : null}
                          </div>
                          <div className="text-[11px] text-slate-700 line-clamp-3 leading-snug min-h-[42px]">{n.narration || '—'}</div>
                          <div className="flex flex-wrap gap-1 mt-1.5">
                            {(n.camera || []).slice(0, 2).map((c, i) => (
                              <span key={i} className="text-[9px] bg-slate-100 text-slate-500 rounded px-1">{c}</span>
                            ))}
                            {(n.overlays || []).map((o) => (
                              <span key={o.idx} className="text-[9px] bg-amber-50 text-amber-700 border border-amber-200 rounded px-1">{o.label}</span>
                            ))}
                          </div>
                        </button>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            ))}

            {/* add place stop */}
            <div className="flex flex-col items-center justify-center pl-4 self-center">
              <div className="w-10 h-0.5 bg-indigo-200 mb-2" />
              <div className="w-56 rounded-xl border border-dashed border-indigo-300 bg-indigo-50/40 p-2">
                <div className="text-xs font-semibold text-indigo-700 mb-1">➕ 加地点停靠</div>
                <input className="w-full text-xs border rounded px-2 py-1" placeholder="搜地点(JBR / 海滩 / 地标)" value={placeQ} onChange={(e) => setPlaceQ(e.target.value)} />
                <div className="flex flex-col gap-1 mt-1 max-h-32 overflow-y-auto">
                  {placeResults.map((p, i) => (
                    <button key={i} disabled={busy} onClick={() => addStop(p)} className="text-left text-xs bg-white border border-indigo-200 hover:border-indigo-400 rounded px-2 py-1 disabled:opacity-50">
                      + {p.name} <span className="text-slate-400">· {p.category}</span>
                    </button>
                  ))}
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* side edit panel */}
        <div className="w-[360px] shrink-0 border-l bg-white overflow-y-auto p-4">
          {!sel ? (
            <div className="text-sm text-slate-400 mt-8 text-center">← 点一个节点来编辑<br />旁白 · 卡片 · 媒体 · AI 改稿</div>
          ) : (
            <div className="space-y-4">
              <div className="text-xs font-semibold text-emerald-700">{sel.isPlace ? '📍 ' : ''}{sel.group} · {KIND_ZH[sel.kind] || sel.kind}</div>

              <div>
                <label className="block text-xs text-slate-400 mb-1">旁白</label>
                <textarea
                  className="w-full border rounded-lg px-3 py-2 text-sm leading-relaxed"
                  rows={5}
                  value={sel.narration}
                  onChange={(e) => setNodes((cur) => cur.map((n) => (n.id === sel.id ? { ...n, narration: e.target.value } : n)))}
                />
              </div>

              <div>
                <label className="block text-xs text-slate-400 mb-1">给 AI 的修改意见</label>
                <input
                  className="w-full border border-dashed border-slate-300 rounded-lg px-2 py-1.5 text-sm"
                  placeholder="短一点 / 强调海景 / 这个数字改成…"
                  value={comments[sel.id] || ''}
                  onChange={(e) => setComments((c) => ({ ...c, [sel.id]: e.target.value }))}
                />
              </div>

              {sel.camera && sel.camera.length > 0 && (
                <div>
                  <label className="block text-xs text-slate-400 mb-1">镜头</label>
                  <div className="flex flex-wrap gap-1">
                    {sel.camera.map((c, i) => <span key={i} className="text-[11px] bg-slate-100 text-slate-600 rounded px-1.5 py-0.5">{c}</span>)}
                  </div>
                </div>
              )}

              <div>
                <label className="block text-xs text-slate-400 mb-1">卡片</label>
                {(sel.overlays || []).length === 0 && <div className="text-xs text-slate-300">无</div>}
                <div className="flex flex-col gap-1">
                  {(sel.overlays || []).map((o) => (
                    <div key={o.idx} className="flex items-center gap-1 text-xs bg-amber-50 border border-amber-200 rounded px-2 py-1">
                      <span className="flex-1 truncate">🃏 {o.label}{o.at > 0 ? ` @${o.at}s` : ''}</span>
                      <button className="px-1 disabled:opacity-30" disabled={o.dur <= 0} onClick={() => editOverlays(sel.id, [{ index: o.idx, duration_ms: Math.max(0, o.dur - 1) * 1000 }])}>−</button>
                      <span className="tabular-nums w-7 text-center">{o.dur}s</span>
                      <button className="px-1" onClick={() => editOverlays(sel.id, [{ index: o.idx, duration_ms: (o.dur + 1) * 1000 }])}>+</button>
                      <button className="px-1 text-rose-400 hover:text-rose-600" onClick={() => editOverlays(sel.id, [{ index: o.idx, remove: true }])}>✕</button>
                    </div>
                  ))}
                </div>
              </div>

              <div>
                <label className="block text-xs text-slate-400 mb-1">加媒体(海景/室内视频或图)</label>
                <input className="w-full text-xs border rounded px-2 py-1 mb-1" placeholder="直链 https://…/clip.mp4" value={mediaUrl} onChange={(e) => setMediaUrl(e.target.value)} />
                <input className="w-full text-xs border rounded px-2 py-1 mb-1" placeholder="说明(可选)" value={mediaCap} onChange={(e) => setMediaCap(e.target.value)} />
                <div className="flex items-center gap-2">
                  <button disabled={mediaBusy || !/^https?:\/\/\S+/i.test(mediaUrl.trim())} onClick={() => addMedia(sel.id, { url: mediaUrl })} className="text-xs bg-indigo-500 text-white rounded px-2.5 py-1 disabled:opacity-50">加链接</button>
                  <label className="text-xs bg-white border border-indigo-300 text-indigo-600 rounded px-2.5 py-1 cursor-pointer">
                    {mediaBusy ? '上传中…' : '或上传文件'}
                    <input type="file" accept="video/mp4,video/webm,video/quicktime,image/jpeg,image/png,image/webp" className="hidden" disabled={mediaBusy}
                      onChange={(e) => { const f = e.target.files?.[0]; if (f) addMedia(sel.id, { file: f }); e.currentTarget.value = '' }} />
                  </label>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
