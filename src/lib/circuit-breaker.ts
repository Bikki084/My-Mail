/**
 * Circuit breaker for external dependencies. Trips open on repeated failures or
 * slow calls; fast-fails (or runs a fallback) until a half-open probe succeeds.
 */

export class CircuitBreakerOpenError extends Error {
  readonly code = "CIRCUIT_BREAKER_OPEN";

  constructor(readonly breakerName: string) {
    super(`Circuit breaker "${breakerName}" is open`);
    this.name = "CircuitBreakerOpenError";
  }
}

export type CircuitState = "closed" | "open" | "half-open";

export type CircuitBreakerSnapshot = {
  name: string;
  state: CircuitState;
  failures: number;
  lastFailureAt: string | null;
  openedAt: string | null;
  halfOpenInFlight: boolean;
  inflight: number;
};

export type CircuitBreakerOptions = {
  name: string;
  /** Consecutive failures (or slow calls) before opening. */
  failureThreshold?: number;
  /** Calls slower than this count as failures. */
  slowCallThresholdMs?: number;
  /** How long the circuit stays open before a half-open probe. */
  resetTimeoutMs?: number;
  /** Max concurrent in-flight calls through this breaker. */
  maxConcurrency?: number;
  /** Default per-call timeout (overridable per execute). */
  timeoutMs?: number;
};

export class CircuitBreaker {
  private state: CircuitState = "closed";
  private failures = 0;
  private lastFailureAt = 0;
  private openedAt = 0;
  private halfOpenInFlight = false;
  private inflight = 0;
  private waiters: Array<() => void> = [];

  readonly name: string;
  private readonly failureThreshold: number;
  private readonly slowCallThresholdMs: number;
  private readonly resetTimeoutMs: number;
  private readonly maxConcurrency: number;
  private readonly defaultTimeoutMs: number;

  constructor(options: CircuitBreakerOptions) {
    this.name = options.name;
    this.failureThreshold = Math.max(1, options.failureThreshold ?? 5);
    this.slowCallThresholdMs = Math.max(0, options.slowCallThresholdMs ?? 0);
    this.resetTimeoutMs = Math.max(1_000, options.resetTimeoutMs ?? 30_000);
    this.maxConcurrency = Math.max(1, options.maxConcurrency ?? 32);
    this.defaultTimeoutMs = Math.max(0, options.timeoutMs ?? 0);
  }

  isOpen(): boolean {
    this.syncStateForHalfOpen();
    return this.state === "open";
  }

  getSnapshot(): CircuitBreakerSnapshot {
    this.syncStateForHalfOpen();
    return {
      name: this.name,
      state: this.state,
      failures: this.failures,
      lastFailureAt: this.lastFailureAt > 0 ? new Date(this.lastFailureAt).toISOString() : null,
      openedAt: this.openedAt > 0 ? new Date(this.openedAt).toISOString() : null,
      halfOpenInFlight: this.halfOpenInFlight,
      inflight: this.inflight,
    };
  }

  /**
   * Run `fn` through the breaker. When open, throws or returns `fallback` without
   * calling `fn`.
   */
  async execute<T>(
    fn: () => Promise<T>,
    options?: {
      fallback?: () => T | Promise<T>;
      timeoutMs?: number;
    },
  ): Promise<T> {
    this.syncStateForHalfOpen();

    if (this.state === "open") {
      if (options?.fallback) return options.fallback();
      throw new CircuitBreakerOpenError(this.name);
    }

    if (this.state === "half-open") {
      if (this.halfOpenInFlight) {
        if (options?.fallback) return options.fallback();
        throw new CircuitBreakerOpenError(this.name);
      }
      this.halfOpenInFlight = true;
    }

    await this.acquireSlot();
    const started = Date.now();
    const timeoutMs = options?.timeoutMs ?? this.defaultTimeoutMs;

    try {
      const result = await this.runWithTimeout(fn, timeoutMs);
      const duration = Date.now() - started;
      if (this.slowCallThresholdMs > 0 && duration > this.slowCallThresholdMs) {
        this.recordFailure();
      } else {
        this.recordSuccess();
      }
      return result;
    } catch (err) {
      this.recordFailure();
      if (options?.fallback) return options.fallback();
      throw err;
    } finally {
      if (this.state === "half-open" || this.halfOpenInFlight) {
        this.halfOpenInFlight = false;
      }
      this.releaseSlot();
    }
  }

  /** Record an external success (e.g. probe succeeded outside execute). */
  recordExternalSuccess(): void {
    this.recordSuccess();
  }

  /** Record an external failure (e.g. probe failed outside execute). */
  recordExternalFailure(): void {
    this.recordFailure();
  }

  private syncStateForHalfOpen(): void {
    if (this.state !== "open") return;
    if (Date.now() - this.openedAt >= this.resetTimeoutMs) {
      this.state = "half-open";
      this.halfOpenInFlight = false;
    }
  }

  private recordSuccess(): void {
    this.failures = 0;
    this.state = "closed";
    this.openedAt = 0;
    this.halfOpenInFlight = false;
  }

  private recordFailure(): void {
    this.failures += 1;
    this.lastFailureAt = Date.now();
    if (this.state === "half-open" || this.failures >= this.failureThreshold) {
      this.state = "open";
      this.openedAt = Date.now();
      this.halfOpenInFlight = false;
    }
  }

  private async runWithTimeout<T>(fn: () => Promise<T>, timeoutMs: number): Promise<T> {
    if (timeoutMs <= 0) return fn();
    return Promise.race([
      fn(),
      new Promise<never>((_, reject) => {
        setTimeout(() => reject(new Error(`CIRCUIT_BREAKER_TIMEOUT:${this.name}`)), timeoutMs);
      }),
    ]);
  }

  private async acquireSlot(): Promise<void> {
    if (this.inflight < this.maxConcurrency) {
      this.inflight += 1;
      return;
    }
    await new Promise<void>((resolve) => {
      this.waiters.push(resolve);
    });
    this.inflight += 1;
  }

  private releaseSlot(): void {
    this.inflight = Math.max(0, this.inflight - 1);
    const next = this.waiters.shift();
    if (next) next();
  }
}

const registry = new Map<string, CircuitBreaker>();

export function getCircuitBreaker(options: CircuitBreakerOptions): CircuitBreaker {
  const existing = registry.get(options.name);
  if (existing) return existing;
  const breaker = new CircuitBreaker(options);
  registry.set(options.name, breaker);
  return breaker;
}

export function listCircuitBreakerSnapshots(): CircuitBreakerSnapshot[] {
  return [...registry.values()].map((b) => b.getSnapshot());
}

/** Shared breakers for known external dependencies. */
export const redisCircuit = getCircuitBreaker({
  name: "redis",
  failureThreshold: 3,
  slowCallThresholdMs: 2_000,
  resetTimeoutMs: 30_000,
  maxConcurrency: 6,
  timeoutMs: 2_500,
});

export const brevoCircuit = getCircuitBreaker({
  name: "brevo-api",
  failureThreshold: 3,
  slowCallThresholdMs: 10_000,
  resetTimeoutMs: 60_000,
  maxConcurrency: 2,
  timeoutMs: 12_000,
});

export const supabaseReadCircuit = getCircuitBreaker({
  name: "supabase-read",
  failureThreshold: 5,
  slowCallThresholdMs: 8_000,
  resetTimeoutMs: 30_000,
  maxConcurrency: 24,
  timeoutMs: 10_000,
});

export const lightsailCircuit = getCircuitBreaker({
  name: "aws-lightsail",
  failureThreshold: 3,
  slowCallThresholdMs: 20_000,
  resetTimeoutMs: 120_000,
  maxConcurrency: 2,
  timeoutMs: 45_000,
});

export const outboundRotationCircuit = getCircuitBreaker({
  name: "outbound-rotation-url",
  failureThreshold: 2,
  slowCallThresholdMs: 15_000,
  resetTimeoutMs: 60_000,
  maxConcurrency: 1,
  timeoutMs: 15_000,
});

export function isRedisCircuitOpen(): boolean {
  return redisCircuit.isOpen();
}
