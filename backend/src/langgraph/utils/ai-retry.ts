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

  let lastError: unknown = null;
  let lastResult: T | undefined;
  let hasResult = false;

  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      const result = await fn(attempt);

      if (!options.validate || options.validate(result)) {
        if (attempt > 1) {
          console.log(`   🔁 [RETRY] ${options.label}: succeeded on attempt ${attempt}/${attempts}`);
        }
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

  if (hasResult) {
    console.warn(`   🔁 [RETRY] ${options.label}: all ${attempts} attempts failed validation, returning last result`);
    return lastResult as T;
  }

  throw lastError;
}
