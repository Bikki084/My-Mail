import dns from "node:dns/promises";
import type { SupabaseClient } from "@supabase/supabase-js";

const MX_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days
const MX_LOOKUP_TIMEOUT_MS = 4_000;
const MX_CONCURRENCY = 24;

/** In-process cache for hot paths within a single request/worker burst. */
const memoryMx = new Map<string, { hasMx: boolean; expiresAt: number }>();

function mxTtlMs(): number {
  const raw = process.env.RECIPIENT_MX_CACHE_TTL_HOURS;
  if (!raw) return MX_TTL_MS;
  const h = Number(raw);
  if (!Number.isFinite(h) || h <= 0) return MX_TTL_MS;
  return h * 60 * 60 * 1000;
}

async function lookupMxLive(domain: string): Promise<boolean> {
  try {
    const records = await Promise.race([
      dns.resolveMx(domain),
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error("mx_timeout")), MX_LOOKUP_TIMEOUT_MS),
      ),
    ]);
    return Array.isArray(records) && records.length > 0;
  } catch (e) {
    const code = (e as NodeJS.ErrnoException).code;
    const msg = e instanceof Error ? e.message : String(e);
    if (code === "ENOTFOUND" || code === "ENODATA" || code === "ESERVFAIL" || msg === "mx_timeout") {
      return false;
    }
    return false;
  }
}

async function readMxFromDb(
  supabase: SupabaseClient | null,
  domain: string,
): Promise<boolean | null> {
  if (!supabase) return null;
  try {
    const { data, error } = await supabase
      .from("domain_mx_cache")
      .select("has_mx, expires_at")
      .eq("domain", domain)
      .maybeSingle();
    if (error || !data) return null;
    const expiresAt = Date.parse(String(data.expires_at));
    if (!Number.isFinite(expiresAt) || expiresAt <= Date.now()) return null;
    return Boolean(data.has_mx);
  } catch {
    return null;
  }
}

async function writeMxToDb(
  supabase: SupabaseClient | null,
  domain: string,
  hasMx: boolean,
): Promise<void> {
  if (!supabase) return;
  const ttl = mxTtlMs();
  const expiresAt = new Date(Date.now() + ttl).toISOString();
  try {
    await supabase.from("domain_mx_cache").upsert(
      {
        domain,
        has_mx: hasMx,
        checked_at: new Date().toISOString(),
        expires_at: expiresAt,
      },
      { onConflict: "domain" },
    );
  } catch {
    // Non-fatal — memory cache still helps within the burst.
  }
}

export async function domainHasMx(
  domain: string,
  supabase: SupabaseClient | null = null,
): Promise<boolean> {
  const d = domain.trim().toLowerCase();
  if (!d) return false;

  const mem = memoryMx.get(d);
  if (mem && mem.expiresAt > Date.now()) return mem.hasMx;

  const cached = await readMxFromDb(supabase, d);
  if (cached !== null) {
    memoryMx.set(d, { hasMx: cached, expiresAt: Date.now() + mxTtlMs() });
    return cached;
  }

  const hasMx = await lookupMxLive(d);
  memoryMx.set(d, { hasMx, expiresAt: Date.now() + mxTtlMs() });
  void writeMxToDb(supabase, d, hasMx);
  return hasMx;
}

/** Resolve MX for many domains with bounded concurrency. */
export async function resolveMxForDomains(
  domains: string[],
  supabase: SupabaseClient | null = null,
): Promise<Map<string, boolean>> {
  const unique = [...new Set(domains.map((d) => d.trim().toLowerCase()).filter(Boolean))];
  const out = new Map<string, boolean>();
  let idx = 0;

  async function worker(): Promise<void> {
    for (;;) {
      const i = idx++;
      if (i >= unique.length) return;
      const domain = unique[i]!;
      out.set(domain, await domainHasMx(domain, supabase));
    }
  }

  const workers = Math.min(MX_CONCURRENCY, unique.length);
  await Promise.all(Array.from({ length: workers }, () => worker()));
  return out;
}
