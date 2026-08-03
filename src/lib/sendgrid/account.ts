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
  /** Monthly plan email allotment (matches SendGrid UI, e.g. 50,000). */
  limit?: number;
  used?: number;
  period?: "day" | "month";
  periodEndsAt?: string;
  accountEmail?: string;
  fetchedAt: string;
  /** SendGrid API sending cap when it differs from plan limit (often 10× plan). */
  apiSendingCap?: number;
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

function formatPlanLabel(planType: string, monthlyLimit?: number): string {
  const base = labelForPlanType(planType);
  if (monthlyLimit == null) return base;
  if (monthlyLimit >= 1_000_000) return `${base} · ${(monthlyLimit / 1_000_000).toFixed(1)}M/mo`;
  if (monthlyLimit >= 1_000) return `${base} · ${Math.round(monthlyLimit / 1_000)}K/mo`;
  return `${base} · ${monthlyLimit.toLocaleString()}/mo`;
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

/**
 * SendGrid dashboard shows the plan email allotment (e.g. 50,000/mo).
 * The credits API `total` on Essentials/Pro is often 10× that cap (API request limit).
 * @see https://support.sendgrid.com/hc/en-us/articles/35466138799899
 */
function resolveDisplayPlanLimit(credits: SendGridCreditsResponse): {
  limit: number | undefined;
  apiSendingCap?: number;
} {
  const envLimit = envPlanLimitOverride();
  if (envLimit != null) {
    return {
      limit: envLimit,
      apiSendingCap:
        typeof credits.total === "number" && credits.total > envLimit
          ? credits.total
          : undefined,
    };
  }

  const total = credits.total;
  if (typeof total !== "number" || !Number.isFinite(total) || total <= 0) {
    return { limit: undefined };
  }

  // Essentials 50K → credits.total=500_000; dashboard shows 50_000.
  if (total >= 100_000 && total % 10 === 0) {
    const planLimit = total / 10;
    if (planLimit >= 1_000 && planLimit <= 2_500_000) {
      return { limit: planLimit, apiSendingCap: total };
    }
  }

  // Free / legacy: total is the plan cap itself.
  if (total <= 100_000) {
    return { limit: total };
  }

  return { limit: total };
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

async function resolveMonthlyUsed(
  apiKey: string,
  credits: SendGridCreditsResponse,
): Promise<number | undefined> {
  const periodStart = credits.last_reset?.trim() || startOfMonthIsoDate();
  const fromStats = await fetchStatsRequests(apiKey, periodStart, todayIsoDate());
  if (fromStats != null) return fromStats;

  if (typeof credits.used === "number" && Number.isFinite(credits.used)) {
    return credits.used;
  }
  return undefined;
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

        if (creditsRes.ok) {
          const c = creditsRes.data;
          const { limit, apiSendingCap } = resolveDisplayPlanLimit(c);
          const used = await resolveMonthlyUsed(apiKey, c);
          const remaining =
            limit != null && used != null ? Math.max(0, limit - used) : undefined;
          const period = periodFromResetFrequency(c.reset_frequency);
          const periodEndsAt = c.next_reset?.trim() || undefined;
          const planLabel = formatPlanLabel(planType, limit);

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
            apiSendingCap,
            fetchedAt,
          };
          cache = { at: now, data: okSnap };
          return okSnap;
        }

        // Credits endpoint unavailable — fall back to stats + optional env limit.
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
            planLabel: labelForPlanType(planType),
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
          planLabel: formatPlanLabel(planType, limit),
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
