/**
 * 把后端错误响应解析成**当前语言**的文案。
 *
 * 【为什么需要它 —— 反向影子】
 * 调用点原本都写成 `d.error || t('lunaTour:editFailed')`。翻译键早就写好了、
 * 5 语言也齐了,但后端一送中文 `error`,`||` 当场短路 —— 那些译文**永远走不到**。
 * 结果:阿拉伯语经纪点一下改稿失败,弹出来的是「改稿失败」四个中文字。
 *
 * 【约定】
 * 后端的 `error` 字段是**给日志/调试看的中文**,前端永远不显示它。
 * 要显示什么由后端的 `code` 决定 —— 认 code,查 `lunaTour:err.<code>`。
 * 没 code、或该 code 还没配译文 → 回退到调用点自己的 fallbackKey
 * (那些 key 本来就带调用点语境:editFailed / publishFailed / uploadFailed…)。
 *
 * 用法:
 *   setMsg(`❌ ${errText(d, 'lunaTour:editFailed')}`)
 */
import i18n from '../i18n'

export interface ApiErrorish {
  code?: string | null
  /** 后端的中文调试文案。**故意不在类型上叫 message** —— 别显示它。 */
  error?: string | null
}

// i18next 的 t() 把 key 收成字面量联合类型,这里的 key 是运行时拼的 → 必须 cast。
// (同 spec §转组件铁律 的 casted t 约定。)
const t = i18n.t.bind(i18n) as (k: string) => string

export function errText(d: ApiErrorish | null | undefined, fallbackKey: string): string {
  const key = d?.code ? `lunaTour:err.${d.code}` : null
  if (key && i18n.exists(key)) return t(key)
  return t(fallbackKey)
}
