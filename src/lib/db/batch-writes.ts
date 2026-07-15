import type { SupabaseClient } from "@supabase/supabase-js";
import { parsePositiveIntEnv } from "@/lib/async-pool";

export const DEFAULT_BATCH_CHUNK_SIZE = 100;

/** Split `items` into fixed-size chunks (minimum chunk size 1). */
export function chunkArray<T>(items: readonly T[], chunkSize: number): T[][] {
  const size = Math.max(1, Math.floor(chunkSize));
  if (items.length === 0) return [];
  const chunks: T[][] = [];
  for (let i = 0; i < items.length; i += size) {
    chunks.push(items.slice(i, i + size));
  }
  return chunks;
}

export type InsertInChunksOptions<T extends Record<string, unknown>> = {
  chunkSize?: number;
  select?: string;
  /** Called when a chunk insert fails (after retries, if any). */
  onChunkError?: (error: { message: string; code?: string }, chunk: T[]) => void;
};

/**
 * Multi-row inserts in chunks to reduce round trips and avoid oversized statements.
 */
export async function insertInChunks<T extends Record<string, unknown>>(
  supabase: SupabaseClient,
  table: string,
  rows: readonly T[],
  options?: InsertInChunksOptions<T>,
): Promise<{ inserted: number; errors: string[] }> {
  if (rows.length === 0) return { inserted: 0, errors: [] };

  const chunkSize = options?.chunkSize ?? DEFAULT_BATCH_CHUNK_SIZE;
  const errors: string[] = [];
  let inserted = 0;

  for (const chunk of chunkArray(rows, chunkSize)) {
    const base = supabase.from(table).insert(chunk);
    const { data, error } = options?.select
      ? await base.select(options.select)
      : await base;
    if (error) {
      errors.push(error.message);
      options?.onChunkError?.(error, chunk);
      continue;
    }
    inserted += options?.select
      ? Array.isArray(data)
        ? data.length
        : 0
      : chunk.length;
  }

  return { inserted, errors };
}

export type SendingLogInsert = {
  campaign_id: string;
  user_id: string;
  recipient_email: string;
  smtp_used: string | null;
  status: "sent" | "failed" | "bounced";
  error_message: string | null;
  sent_at?: string;
};

function createAsyncMutex() {
  let chain = Promise.resolve();
  return function withLock<T>(fn: () => Promise<T>): Promise<T> {
    const run = chain.then(fn, fn);
    chain = run.then(
      () => undefined,
      () => undefined,
    );
    return run;
  };
}

/**
 * Buffers `sending_logs` rows from parallel SMTP workers and flushes in chunks.
 */
export class SendingLogBatcher {
  private buffer: SendingLogInsert[] = [];
  private readonly withLock = createAsyncMutex();
  private readonly chunkSize: number;

  constructor(
    private readonly supabase: SupabaseClient,
    options?: { chunkSize?: number; logPrefix?: string },
  ) {
    this.chunkSize = parsePositiveIntEnv(
      "SENDING_LOG_BATCH_SIZE",
      options?.chunkSize ?? DEFAULT_BATCH_CHUNK_SIZE,
    );
  }

  async push(row: SendingLogInsert): Promise<void> {
    await this.withLock(async () => {
      this.buffer.push(row);
      if (this.buffer.length >= this.chunkSize) {
        await this.flushUnlocked();
      }
    });
  }

  async pushMany(rows: readonly SendingLogInsert[]): Promise<void> {
    if (rows.length === 0) return;
    await this.withLock(async () => {
      this.buffer.push(...rows);
      while (this.buffer.length >= this.chunkSize) {
        await this.flushUnlocked();
      }
    });
  }

  async flush(): Promise<void> {
    await this.withLock(async () => {
      while (this.buffer.length > 0) {
        await this.flushUnlocked();
      }
    });
  }

  private async flushUnlocked(): Promise<void> {
    if (this.buffer.length === 0) return;
    const chunk = this.buffer.splice(0, this.chunkSize);
    const { error } = await this.supabase.from("sending_logs").insert(chunk);
    if (error) {
      console.warn(
        `[campaign-delivery] sending_logs batch insert failed (${chunk.length} rows): ${error.message}`,
      );
    }
  }
}
