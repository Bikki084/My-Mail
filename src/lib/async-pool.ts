/** Run async work over `items` with at most `concurrency` tasks in flight. */
export async function runAsyncPool<T>(
  items: readonly T[],
  concurrency: number,
  worker: (item: T, index: number) => Promise<void>,
): Promise<void> {
  const limit = Math.max(1, Math.floor(concurrency));
  if (items.length === 0) return;

  let nextIndex = 0;
  async function runOne(): Promise<void> {
    for (;;) {
      const i = nextIndex;
      nextIndex += 1;
      if (i >= items.length) return;
      await worker(items[i]!, i);
    }
  }

  const runners = Array.from(
    { length: Math.min(limit, items.length) },
    () => runOne(),
  );
  await Promise.all(runners);
}

export function parsePositiveIntEnv(name: string, fallback: number): number {
  const raw = process.env[name]?.trim();
  if (!raw) return fallback;
  const n = parseInt(raw, 10);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}
