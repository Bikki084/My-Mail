/**
 * Maps recipient index → SMTP server index for campaign delivery.
 *
 * - **chunked** (default for `round_robin`, `threshold`, and unknown): split
 *   `n` recipients into `k` contiguous blocks as evenly as possible — e.g.
 *   100 recipients and 5 SMTPs → 20 each; 200 recipients and 1 SMTP → 200 on
 *   that one account.
 * - **alternating** (legacy `round_robin` per-recipient rotate): `i % k`.
 * - **random**: deterministic hash from campaign id + index (stable across retries).
 */
export function pickSmtpListIndex(
  recipientIndex: number,
  recipientCount: number,
  smtpCount: number,
  rotationStrategy: string | null | undefined,
  campaignId: string,
): number {
  const k = smtpCount;
  const n = recipientCount;
  const i = recipientIndex;
  if (k <= 0) return 0;
  if (k === 1) return 0;

  const strategy = (rotationStrategy ?? "round_robin").trim();

  if (strategy === "random") {
    let h = 2166136261;
    for (let p = 0; p < campaignId.length; p++) {
      h ^= campaignId.charCodeAt(p);
      h = Math.imul(h, 16777619);
    }
    return Math.abs((h + i * 0x9e3779b9) >>> 0) % k;
  }

  if (strategy === "alternating") {
    return i % k;
  }

  // `chunked`, `round_robin`, `threshold`, or anything else: even contiguous blocks.
  const base = Math.floor(n / k);
  const rem = n % k;
  let start = 0;
  for (let s = 0; s < k; s++) {
    const size = base + (s < rem ? 1 : 0);
    if (i >= start && i < start + size) return s;
    start += size;
  }
  return k - 1;
}

/** One recipient assigned to an SMTP list index (for parallel per-account workers). */
export type RecipientSmtpAssignment<TRecipient> = {
  smtpIndex: number;
  recipientIndex: number;
  recipient: TRecipient;
};

/**
 * Split recipients into per-SMTP queues using the same strategy as {@link pickSmtpListIndex}.
 * Each bucket is processed sequentially by one worker; buckets run in parallel.
 */
export function partitionRecipientsBySmtp<TRecipient>(
  recipients: TRecipient[],
  smtpCount: number,
  rotationStrategy: string | null | undefined,
  campaignId: string,
): Map<number, RecipientSmtpAssignment<TRecipient>[]> {
  const buckets = new Map<number, RecipientSmtpAssignment<TRecipient>[]>();
  for (let s = 0; s < smtpCount; s++) {
    buckets.set(s, []);
  }
  for (let i = 0; i < recipients.length; i++) {
    const smtpIndex = pickSmtpListIndex(
      i,
      recipients.length,
      smtpCount,
      rotationStrategy,
      campaignId,
    );
    buckets.get(smtpIndex)!.push({
      smtpIndex,
      recipientIndex: i,
      recipient: recipients[i]!,
    });
  }
  return buckets;
}
