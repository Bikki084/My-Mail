/**
 * Four fixed merge tags always available (rename keys only; values are generated per recipient).
 */
export type BuiltInMergeTagId =
  | "builtin-invoice"
  | "builtin-transaction"
  | "builtin-id"
  | "builtin-date";

export type BuiltInMergeTagConfig = {
  id: BuiltInMergeTagId;
  /** Merge key used in `{{{key}}}` — user may rename, not add/remove slots. */
  key: string;
};

export const DEFAULT_BUILT_IN_MERGE_TAGS: BuiltInMergeTagConfig[] = [
  { id: "builtin-invoice", key: "invoice_number" },
  { id: "builtin-transaction", key: "transaction_id" },
  { id: "builtin-id", key: "id" },
  { id: "builtin-date", key: "date" },
];

const SLOT_IDS = new Set<BuiltInMergeTagId>(
  DEFAULT_BUILT_IN_MERGE_TAGS.map((t) => t.id),
);

function hashSeed(seed: string): number {
  let h = 2166136261;
  for (let i = 0; i < seed.length; i++) {
    h ^= seed.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function createRng(seed: string): () => number {
  let state = hashSeed(seed) || 1;
  return () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 0xffffffff;
  };
}

function randDigit(rng: () => number): string {
  return String(Math.floor(rng() * 10) % 10);
}

function randLetter(rng: () => number): string {
  return String.fromCharCode(65 + (Math.floor(rng() * 26) % 26));
}

/** INV- + 7 digits, e.g. INV-8395729 */
export function generateInvoiceNumber(rng: () => number): string {
  return `INV-${Array.from({ length: 7 }, () => randDigit(rng)).join("")}`;
}

/** 3 digits + 3 letters + 4 digits (10 chars), e.g. 830GJL7394 */
export function generateTransactionId(rng: () => number): string {
  const digits = (n: number) => Array.from({ length: n }, () => randDigit(rng)).join("");
  const letters = (n: number) => Array.from({ length: n }, () => randLetter(rng)).join("");
  return `${digits(3)}${letters(3)}${digits(4)}`;
}

/** 8 digits, e.g. 73957298 */
export function generateRecipientId(rng: () => number): string {
  return Array.from({ length: 8 }, () => randDigit(rng)).join("");
}

/** Today's date in mm/dd/yyyy */
export function formatTodayDateMmDdYyyy(now = new Date()): string {
  const mm = String(now.getMonth() + 1).padStart(2, "0");
  const dd = String(now.getDate()).padStart(2, "0");
  const yyyy = now.getFullYear();
  return `${mm}/${dd}/${yyyy}`;
}

const VALUE_BY_SLOT: Record<
  BuiltInMergeTagId,
  (email: string, now: Date) => string
> = {
  "builtin-invoice": (email) =>
    generateInvoiceNumber(createRng(`${email.toLowerCase()}:invoice`)),
  "builtin-transaction": (email) =>
    generateTransactionId(createRng(`${email.toLowerCase()}:transaction`)),
  "builtin-id": (email) =>
    generateRecipientId(createRng(`${email.toLowerCase()}:recipient-id`)),
  "builtin-date": (_email, now) => formatTodayDateMmDdYyyy(now),
};

/** Per-recipient built-in values keyed by the user-configured merge tag names. */
export function generateBuiltInFieldsForRecipient(
  email: string,
  configs: BuiltInMergeTagConfig[],
  options?: { now?: Date },
): Record<string, string> {
  const now = options?.now ?? new Date();
  const normEmail = email.trim().toLowerCase();
  const out: Record<string, string> = {};
  for (const c of configs) {
    const key = c.key.trim();
    if (!key) continue;
    const gen = VALUE_BY_SLOT[c.id];
    if (gen) out[key] = gen(normEmail, now);
  }
  return out;
}

export function normalizeBuiltInMergeTags(
  input: BuiltInMergeTagConfig[] | undefined,
): BuiltInMergeTagConfig[] {
  const byId = new Map<BuiltInMergeTagId, string>();
  if (Array.isArray(input)) {
    for (const t of input) {
      if (!t?.id || !SLOT_IDS.has(t.id)) continue;
      const key = String(t.key ?? "").trim();
      if (!key || !/^[\w.-]+$/.test(key)) continue;
      byId.set(t.id, key);
    }
  }
  return DEFAULT_BUILT_IN_MERGE_TAGS.map((d) => ({
    id: d.id,
    key: byId.get(d.id) ?? d.key,
  }));
}

export function builtInMergeTagKeys(configs: BuiltInMergeTagConfig[]): string[] {
  return configs.map((c) => c.key.trim()).filter(Boolean);
}

/** CSV columns + built-in keys for autocomplete / insert menus. */
export function allMergeTagKeys(
  columnOrder: string[],
  builtInConfigs: BuiltInMergeTagConfig[],
): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const col of columnOrder) {
    const k = col.trim();
    if (!k) continue;
    const lower = k.toLowerCase();
    if (seen.has(lower)) continue;
    seen.add(lower);
    out.push(k);
  }
  for (const t of builtInConfigs) {
    const k = t.key.trim();
    if (!k) continue;
    const lower = k.toLowerCase();
    if (seen.has(lower)) continue;
    seen.add(lower);
    out.push(k);
  }
  return out.sort((a, b) => a.localeCompare(b, undefined, { sensitivity: "base" }));
}

export function builtInTagLabel(id: BuiltInMergeTagId): string {
  switch (id) {
    case "builtin-invoice":
      return "Invoice number";
    case "builtin-transaction":
      return "Transaction Id";
    case "builtin-id":
      return "Id";
    case "builtin-date":
      return "Date";
    default:
      return id;
  }
}
