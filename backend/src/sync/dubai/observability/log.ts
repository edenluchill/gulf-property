/** Tiny structured logger. Prefixes every line with timestamp + context. */

function ts(): string {
  return new Date().toISOString()
}

export interface Logger {
  info: (...args: any[]) => void
  warn: (...args: any[]) => void
  error: (...args: any[]) => void
}

export function makeLogger(context: string): Logger {
  const p = `[${context}]`
  return {
    info: (...a: any[]) => console.log(ts(), p, ...a),
    warn: (...a: any[]) => console.warn(ts(), p, '⚠️', ...a),
    error: (...a: any[]) => console.error(ts(), p, '❌', ...a),
  }
}

export const log = makeLogger('dubai-sync')
