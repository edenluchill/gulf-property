import { counter, histogram } from '../../telemetry';
import { classifyAiError } from '../../services/ai/gemini';
/**
 * Retry helper for AI agent calls
 *
 * LLM calls fail transiently (timeouts, malformed JSON, rate limits).
 * A single failure must not silently drop extracted data — every agent
 * call that feeds required fields should go through withRetry.
 */

export interface RetryOptions<T> {
  /** Total attempts including the first one. Default 3. */
  attempts?: number;
  /** Label used in log lines, e.g. "unit-extractor:Type A". */
  label: string;
  /** Base delay between attempts in ms (multiplied by attempt number). Default 1000. */
  delayMs?: number;
  /**
   * Optional result validation. If it returns false the result is treated
   * as a soft failure and retried. If all attempts fail validation, the
   * LAST result is still returned (partial data beats no data).
   */
  validate?: (result: T) => boolean;
}

const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

/**
 * label 形如 "unit-extractor:Type A" —— 冒号后面是**每次都不同的**数据(户型名/页码),
 * 直接当 metric label 会炸基数。只取前缀(agent 名),它是低基数枚举。
 */
function agentOf(label: string): string {
  return label.split(':')[0].trim().slice(0, 40) || 'unknown';
}

/**
 * Run an async AI call with retries.
 *
 * - Thrown errors: retried; if every attempt throws, the last error is re-thrown.
 * - Validation failures: retried; if every attempt fails validation, the last
 *   successfully-parsed result is returned anyway.
 */
export async function withRetry<T>(
  fn: (attempt: number) => Promise<T>,
  options: RetryOptions<T>
): Promise<T> {
  const attempts = options.attempts ?? 3;
  const delayMs = options.delayMs ?? 1000;
  // 所有 langgraph 的 AI 调用都从这里过 → 埋在这一处 = 整条 PDF 管线的 AI 全覆盖。
  // (2026-07-13:project-description-generator 用着一个**已经 404** 的模型,
  //  每传一份楼书都在失败,靠一行 console.warn —— 一直没人发现。就是因为这里没埋点。)
  const agent = agentOf(options.label);
  const t0 = Date.now();

  let lastError: unknown = null;
  let lastResult: T | undefined;
  let hasResult = false;

  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      const result = await fn(attempt);

      if (!options.validate || options.validate(result)) {
        if (attempt > 1) {
          console.log(`   🔁 [RETRY] ${options.label}: succeeded on attempt ${attempt}/${attempts}`);
          counter('pdf.ai.retry', { agent }).inc(attempt - 1);
        }
        counter('pdf.ai.call', { agent, result: 'ok' }).inc();
        histogram('pdf.ai.ms', { agent }).observe(Date.now() - t0);
        return result;
      }

      lastResult = result;
      hasResult = true;
      console.warn(`   🔁 [RETRY] ${options.label}: attempt ${attempt}/${attempts} returned invalid result${attempt < attempts ? ', retrying...' : ''}`);
    } catch (error) {
      lastError = error;
      console.warn(`   🔁 [RETRY] ${options.label}: attempt ${attempt}/${attempts} failed: ${(error as Error).message}${attempt < attempts ? ', retrying...' : ''}`);
    }

    if (attempt < attempts) {
      await sleep(delayMs * attempt);
    }
  }

  histogram('pdf.ai.ms', { agent }).observe(Date.now() - t0);
  counter('pdf.ai.retry', { agent }).inc(attempts - 1);

  if (hasResult) {
    console.warn(`   🔁 [RETRY] ${options.label}: all ${attempts} attempts failed validation, returning last result`);
    // 「校验没过但还是把结果用了」—— 数据质量在悄悄下滑,必须能看见
    counter('pdf.ai.call', { agent, result: 'invalid' }).inc();
    return lastResult as T;
  }

  // 全部尝试都抛错 = 这个抽取步骤此刻是**坏的**(客户的楼书会缺这块数据)
  counter('pdf.ai.call', { agent, result: 'failed' }).inc();
  counter('pdf.ai.exhausted', { agent, reason: classifyAiError(lastError) }).inc();
  throw lastError;
}
