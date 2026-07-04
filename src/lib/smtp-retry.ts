import "server-only";

const TRANSIENT_SMTP =
  /timeout|timed out|etimedout|econnreset|econnrefused|epipe|enotfound|eai_again|421|450|452|454|429|try again|rate limit|too many|temporarily|service not available|connection lost|socket hang up/i;

export function isTransientSmtpError(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err);
  return TRANSIENT_SMTP.test(msg);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Retry SMTP sends on transient provider/network errors (421, timeouts, etc.).
 */
export async function withSmtpSendRetry<T>(
  fn: () => Promise<T>,
  options?: { maxAttempts?: number; baseDelayMs?: number },
): Promise<T> {
  const maxAttempts = Math.max(1, options?.maxAttempts ?? 3);
  const baseDelayMs = Math.max(100, options?.baseDelayMs ?? 800);
  let lastErr: unknown;

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      return await fn();
    } catch (err) {
      lastErr = err;
      if (attempt >= maxAttempts || !isTransientSmtpError(err)) throw err;
      const delayMs = Math.min(12_000, baseDelayMs * 2 ** (attempt - 1));
      console.warn(
        `[smtp-retry] transient error (attempt ${attempt}/${maxAttempts}), retry in ${delayMs}ms: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
      await sleep(delayMs);
    }
  }

  throw lastErr instanceof Error ? lastErr : new Error(String(lastErr));
}
