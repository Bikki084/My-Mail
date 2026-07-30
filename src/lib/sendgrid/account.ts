import "server-only";
import { sendgridCircuit } from "@/lib/circuit-breaker";

const CACHE_TTL_MS = 120_000;

export type SendGridQuotaSnapshot = {
  configured: boolean;
  live: boolean;
  error?: string;
  planType?: string;
  planLabel?: string;
  remaining?: number;
  limit?: number;
  used?: number;
  period?: "day" | "month";
  periodEndsAt?: string;
  accountEmail?: string;
  fetchedAt: string;
};

type SendGridCreditsResponse = {
  remain?: number;
  total?: number;
  used?: number;
  overage?: number;
  last_reset?: string;
  next_reset?: string;
  reset_frequency?: string;
};

type SendGridAccountResponse = {
  type?: string;
};

type SendGridEmailResponse = {
  email?: string;
};

type SendGridStatsDay = {
  date?: string;
  stats?: { metrics?: { requests?: number } }[];
};

let cache: { at: number; data: SendGridQuotaSnapshot } | null = null;

function notConfigured(message?: string): SendGridQuotaSnapshot {
  return {
    configured: false,
    live: false,
    error: message ?? "SENDGRID_API_KEY is not set on the server.",
    fetchedAt: new Date().toISOString(),
  };
}

function apiBaseUrl(): string {
  const raw = process.env.SENDGRID_API_BASE?.trim();
  if (raw) return raw.replace(/\/$/, "");
  return "https://api.sendgrid.com";
}

function envPlanLimitOverride(): number | undefined {
  const raw = process.env.SENDGRID_EMAIL_PLAN_LIMIT?.trim();
  if (!raw) return undefined;
  const n = parseInt(raw, 10);
  return Number.isFinite(n) && n > 0 ? n : undefined;
}

function labelForPlanType(type: string): string {
  const t = type.trim().toLowerCase();
  if (t === "free") return "Free";
  if (t === "trial") return "Trial";
  if (t === "paid") return "Paid";
  return type.charAt(0).toUpperCase() + type.slice(1);
}

function periodFromResetFrequency(freq?: string): "day" | "month" {
  return freq?.trim().toLowerCase() === "daily" ? "day" : "month";
}

function todayIsoDate(): string {
  return new Date().toISOString().slice(0, 10);
}

function startOfMonthIsoDate(): string {
  const d = new Date();
  d.setUTCDate(1);
  return d.toISOString().slice(0, 10);
}

async function sendGridGet<T>(
  apiKey: string,
  path: string,
): Promise<{ ok: true; data: T } | { ok: false; status: number; body: string }> {
  const res = await fetch(`${apiBaseUrl()}${path}`, {
    method: "GET",
    headers: {
      Accept: "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    cache: "no-store",
    signal: AbortSignal.timeout(12_000),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    return { ok: false, status: res.status, body };
  }
  const data = (await res.json()) as T;
  return { ok: true, data };
}

async function fetchStatsRequests(
  apiKey: string,
  startDate: string,
  endDate: string,
): Promise<number | null> {
  const params = new URLSearchParams({ start_date: startDate, end_date: endDate });
  const result = await sendGridGet<SendGridStatsDay[]>(
    apiKey,
    `/v3/stats?${params.toString()}`,
  );
  if (!result.ok) return null;

  let total = 0;
  for (const day of result.data ?? []) {
    for (const block of day.stats ?? []) {
      const n = block.metrics?.requests;
      if (typeof n === "number" && Number.isFinite(n)) total += n;
    }
  }
  return total;
}

export async function fetchSendGridQuota(options?: {
  force?: boolean;
}): Promise<SendGridQuotaSnapshot> {
  const force = options?.force === true;
  const now = Date.now();
  if (!force && cache && now - cache.at < CACHE_TTL_MS) {
    return cache.data;
  }

  const apiKey = process.env.SENDGRID_API_KEY?.trim();
  if (!apiKey) {
    const snap = notConfigured();
    cache = { at: now, data: snap };
    return snap;
  }

  const fetchedAt = new Date().toISOString();

  try {
    const snap = await sendgridCircuit.execute(
      async () => {
        const [creditsRes, accountRes, emailRes] = await Promise.all([
          sendGridGet<SendGridCreditsResponse>(apiKey, "/v3/user/credits"),
          sendGridGet<SendGridAccountResponse>(apiKey, "/v3/user/account"),
          sendGridGet<SendGridEmailResponse>(apiKey, "/v3/user/email"),
        ]);

        const accountEmail = emailRes.ok ? emailRes.data.email : undefined;
        const planType = accountRes.ok
          ? (accountRes.data.type ?? "unknown").toLowerCase()
          : "unknown";
        const planLabel = labelForPlanType(planType);

        if (creditsRes.ok) {
          const c = creditsRes.data;
          const remaining =
            typeof c.remain === "number" && Number.isFinite(c.remain) ? c.remain : undefined;
          const used =
            typeof c.used === "number" && Number.isFinite(c.used) ? c.used : undefined;
          let limit =
            typeof c.total === "number" && Number.isFinite(c.total) && c.total > 0
              ? c.total
              : envPlanLimitOverride();

          if (limit == null && remaining != null && used != null) {
            limit = remaining + used;
          }

          const period = periodFromResetFrequency(c.reset_frequency);
          const periodEndsAt = c.next_reset?.trim() || undefined;

          const okSnap: SendGridQuotaSnapshot = {
            configured: true,
            live: true,
            planType,
            planLabel,
            remaining,
            limit,
            used,
            period,
            periodEndsAt,
            accountEmail,
            fetchedAt,
          };
          cache = { at: now, data: okSnap };
          return okSnap;
        }

        // Credits endpoint unavailable on some plans — fall back to stats + optional limit.
        const envLimit = envPlanLimitOverride();
        const startDate = startOfMonthIsoDate();
        const usedFromStats = await fetchStatsRequests(apiKey, startDate, todayIsoDate());

        if (usedFromStats == null && !envLimit) {
          const errSnap: SendGridQuotaSnapshot = {
            configured: true,
            live: false,
            error: `SendGrid API ${creditsRes.status}${creditsRes.body ? `: ${creditsRes.body.slice(0, 120)}` : ""}`,
            accountEmail,
            planType,
            planLabel,
            fetchedAt,
          };
          cache = { at: now, data: errSnap };
          throw new Error(errSnap.error ?? `SendGrid API ${creditsRes.status}`);
        }

        const used = usedFromStats ?? undefined;
        const limit = envLimit;
        const remaining =
          limit != null && used != null ? Math.max(0, limit - used) : undefined;

        const okSnap: SendGridQuotaSnapshot = {
          configured: true,
          live: true,
          planType,
          planLabel,
          remaining,
          limit,
          used,
          period: "month",
          accountEmail,
          fetchedAt,
        };
        cache = { at: now, data: okSnap };
        return okSnap;
      },
      {
        fallback: () => {
          if (cache?.data.live) {
            return {
              ...cache.data,
              error: "SendGrid API temporarily unavailable — showing last known quota.",
              fetchedAt,
            };
          }
          return {
            configured: true,
            live: false,
            error: "SendGrid API temporarily unavailable (circuit open). Try again shortly.",
            fetchedAt,
          };
        },
      },
    );
    return snap;
  } catch (err) {
    if (cache?.data) {
      return {
        ...cache.data,
        live: false,
        error: err instanceof Error ? err.message : "SendGrid API request failed.",
        fetchedAt,
      };
    }
    const snap: SendGridQuotaSnapshot = {
      configured: true,
      live: false,
      error: err instanceof Error ? err.message : "SendGrid API request failed.",
      fetchedAt,
    };
    cache = { at: now, data: snap };
    return snap;
  }
}
