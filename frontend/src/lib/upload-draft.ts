/**
 * Upload draft persistence — 刷新 / 误关标签页不再丢掉正在处理的楼书。
 *
 * jobId 是唯一真相源(后端 task 表里就有它),所以 URL 上挂 ?job=<jobId> 就能把
 * 一次上传"钉"在地址里。草稿只是本地快照,存两样后端拿不回来的东西:
 *   1. 文件名/大小(File 对象本身浏览器不允许恢复)
 *   2. 经纪在审核工作台里手改过的字段 —— 这是最不能丢的
 * 任务本身的进度和 AI 提取结果始终以 SSE 重连拿到的为准。
 */
import { PropertyFormData } from '../components/property-editor/types'

const PREFIX = 'pinzos_upload_draft_'
const MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000

export interface UploadFileMeta {
  name: string
  size: number
}

export interface UploadDraft {
  jobId: string
  /** running = 还在上传/处理(刷新后要重连 SSE);done = 已出结果,直接用草稿 */
  status: 'running' | 'done'
  fileMeta: UploadFileMeta[]
  formData: PropertyFormData
  serverReadiness: unknown | null
  duplicateNames: string[]
  savedAt: number
}

export function readDraft(jobId: string): UploadDraft | null {
  try {
    const raw = localStorage.getItem(PREFIX + jobId)
    if (!raw) return null
    const draft = JSON.parse(raw) as UploadDraft
    if (!draft?.formData || Date.now() - (draft.savedAt || 0) > MAX_AGE_MS) {
      clearDraft(jobId)
      return null
    }
    return draft
  } catch {
    return null
  }
}

export function writeDraft(draft: Omit<UploadDraft, 'savedAt'>): void {
  try {
    localStorage.setItem(
      PREFIX + draft.jobId,
      JSON.stringify({ ...draft, savedAt: Date.now() })
    )
  } catch (e) {
    // 配额爆了不能把上传流程带崩 —— 大不了这次刷新丢草稿,SSE 仍能重建 AI 结果
    console.warn('[upload-draft] 保存草稿失败(忽略):', e)
  }
}

export function clearDraft(jobId: string): void {
  try {
    localStorage.removeItem(PREFIX + jobId)
  } catch {
    /* ignore */
  }
}

/** 顺手清掉过期草稿,别让 localStorage 越攒越肥 */
export function pruneDrafts(): void {
  try {
    for (let i = localStorage.length - 1; i >= 0; i--) {
      const key = localStorage.key(i)
      if (!key?.startsWith(PREFIX)) continue
      try {
        const d = JSON.parse(localStorage.getItem(key) || '{}')
        if (Date.now() - (d.savedAt || 0) > MAX_AGE_MS) localStorage.removeItem(key)
      } catch {
        localStorage.removeItem(key)
      }
    }
  } catch {
    /* ignore */
  }
}
