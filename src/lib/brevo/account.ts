import "server-only";
import { brevoCircuit } from "@/lib/circuit-breaker";

/** Brevo free plan daily email cap (transactional + marketing share this pool). */
export const BREVO_FREE_DAILY_LIMIT = 300;

const BREVO_ACCOUNT_URL = "https://api.brevo.com/v3/account";
const BREVO_AGGREGATED_URL = "https://api.brevo.com/v3/smtp/statistics/aggregatedReport";
const CACHE_TTL_MS = 120_000;

export type BrevoQuotaSnapshot = {
  configured: boolean;
  live: boolean;
  error?: string;
  planType?: string;
  planLabel?: string;
  /** Remaining emails in the current period (day or month). */
  remaining?: number;
  /** Known quota cap when Brevo exposes it (e.g. 300/day on Free). */
  limit?: number;
  used?: number;
  period?: "day" | "month";
  /** Paid-plan pool end date when Brevo exposes it (ISO date YYYY-MM-DD). */
  periodEndsAt?: string;
  accountEmail?: string;
  fetchedAt: string;
};

type BrevoPlanRow = {
  type?: string;
  creditsType?: string;
  credits?: number;
};

type BrevoPlanVertical = {
  planCategory?: string;
  planType?: string;
  name?: string;
  status?: string;
  credits?: string | number;
  /** Unix seconds (string) for the active plan window. */
  startDate?: string;
  endDate?: string;
};

type BrevoAggregatedReport = {
  requests?: number;
  delivered?: number;
  range?: string;
};

type BrevoAccountResponse = {
  email?: string;
  plan?: BrevoPlanRow[];
  planVerticals?: BrevoPlanVertical[];
};

let cache: { at: number; data: BrevoQuotaSnapshot } | null = null;

function notConfigured(message?: string): BrevoQuotaSnapshot {
  return {
    configured: false,
    live: false,
    error: message ?? "BREVO_API_KEY is not set on the server.",
    fetchedAt: new Date().toISOString(),
  };
}

function labelForPlanType(type: string): string {
  const t = type.trim().toLowerCase();
  if (t === "free") return "Free";
  if (t === "starter") return "Starter";
  if (t === "business") return "Business";
  if (t === "enterprise") return "Enterprise";
  return type.charAt(0).toUpperCase() + type.slice(1);
}

function parseUnixDateField(value?: string): string | undefined {
  if (!value?.trim()) return undefined;
  const n = parseInt(value.trim(), 10);
  if (!Number.isFinite(n) || n <= 0) return undefined;
  return new Date(n * 1000).toISOString().slice(0, 10);
}

function todayIsoDate(): string {
  return new Date().toISOString().slice(0, 10);
}

function startOfMonthIsoDate(): string {
  const d = new Date();
  d.setUTCDate(1);
  return d.toISOString().slice(0, 10);
}

/** Optional override when Brevo only exposes remaining credits (paid pools). */
function envPlanLimitOverride(): number | undefined {
  const raw = process.env.BREVO_EMAIL_PLAN_LIMIT?.trim();
  if (!raw) return undefined;
  const n = parseInt(raw, 10);
  return Number.isFinite(n) && n > 0 ? n : undefined;
}

async function fetchSmtpRequestsInPeriod(
  apiKey: string,
  startDate: string,
  endDate: string,
): Promise<number | null> {
  const params = new URLSearchParams({ startDate, endDate });
  const res = await fetch(`${BREVO_AGGREGATED_URL}?${params.toString()}`, {
    method: "GET",
    headers: {
      accept: "application/json",
      "api-key": apiKey,
    },
    cache: "no-store",
    signal: AbortSignal.timeout(12_000),
  });
  if (!res.ok) return null;
  const data = (await res.json()) as BrevoAggregatedReport;
  const requests = data.requests;
  return typeof requests === "number" && Number.isFinite(requests) ? requests : null;
}

function parseEmailSendPlan(data: BrevoAccountResponse): {
  planType: string;
  planLabel: string;
  remaining: number;
  period: "day" | "month";
  limit?: number;
  periodStart?: string;
  periodEnd?: string;
} | null {
  const rows = data.plan ?? [];
  const sendRow =
    rows.find(
      (p) =>
        p.creditsType === "sendLimit" &&
        p.type &&
        p.type.toLowerCase() !== "sms" &&
        typeof p.credits === "number",
    ) ?? rows.find((p) => p.creditsType === "sendLimit" && typeof p.credits === "number");

  const marketing = (data.planVerticals ?? []).find(
    (v) => v.planCategory?.toLowerCase() === "marketing" && v.status === "active",
  );

  const planType = (
    sendRow?.type ??
    marketing?.planType ??
    marketing?.name ??
    "unknown"
  )
    .toString()
    .toLowerCase();

  const remainingFromVertical = marketing?.credits;
  const remaining =
    typeof sendRow?.credits === "number"
      ? sendRow.credits
      : typeof remainingFromVertical === "number"
        ? remainingFromVertical
        : typeof remainingFromVertical === "string"
          ? parseInt(remainingFromVertical, 10)
          : NaN;

  if (!Number.isFinite(remaining)) return null;

  const isFree = planType === "free";
  const period: "day" | "month" = isFree ? "day" : "month";
  const limit = isFree ? BREVO_FREE_DAILY_LIMIT : envPlanLimitOverride();

  const periodStart =
    parseUnixDateField(marketing?.startDate) ??
    (isFree ? todayIsoDate() : startOfMonthIsoDate());
  const periodEnd = parseUnixDateField(marketing?.endDate);

  return {
    planType,
    planLabel: marketing?.name?.trim() || labelForPlanType(planType),
    remaining,
    period,
    limit,
    periodStart,
    periodEnd,
  };
}

async function resolvePaidPlanUsage(
  apiKey: string,
  parsed: {
    remaining: number;
    limit?: number;
    periodStart?: string;
    periodEnd?: string;
  },
): Promise<{ limit?: number; used?: number }> {
  const envLimit = envPlanLimitOverride();
  if (envLimit != null) {
    return {
      limit: envLimit,
      used: Math.max(0, envLimit - parsed.remaining),
    };
  }

  const startDate = parsed.periodStart ?? startOfMonthIsoDate();
  const endDate = todayIsoDate();
  const requests = await fetchSmtpRequestsInPeriod(apiKey, startDate, endDate);

  if (requests != null) {
    const limit = requests + parsed.remaining;
    return {
      limit: limit > 0 ? limit : undefined,
      used: requests,
    };
  }

  return { limit: parsed.limit, used: undefined };
}

export async function fetchBrevoQuota(options?: {
  force?: boolean;
}): Promise<BrevoQuotaSnapshot> {
  const force = options?.force === true;
  const now = Date.now();
  if (!force && cache && now - cache.at < CACHE_TTL_MS) {
    return cache.data;
  }

  const apiKey = process.env.BREVO_API_KEY?.trim();
  if (!apiKey) {
    const snap = notConfigured();
    cache = { at: now, data: snap };
    return snap;
  }

  const fetchedAt = new Date().toISOString();

  try {
    const snap = await brevoCircuit.execute(
      async () => {
        const res = await fetch(BREVO_ACCOUNT_URL, {
          method: "GET",
          headers: {
            accept: "application/json",
            "api-key": apiKey,
          },
          cache: "no-store",
          signal: AbortSignal.timeout(12_000),
        });

        if (!res.ok) {
          const body = await res.text().catch(() => "");
          const errSnap: BrevoQuotaSnapshot = {
            configured: true,
            live: false,
            error: `Brevo API ${res.status}${body ? `: ${body.slice(0, 120)}` : ""}`,
            fetchedAt,
          };
          cache = { at: now, data: errSnap };
          throw new Error(errSnap.error ?? `Brevo API ${res.status}`);
        }

        const data = (await res.json()) as BrevoAccountResponse;
        const parsed = parseEmailSendPlan(data);

        if (!parsed) {
          const errSnap: BrevoQuotaSnapshot = {
            configured: true,
            live: false,
            error: "Could not read email quota from Brevo account response.",
            accountEmail: data.email,
            fetchedAt,
          };
          cache = { at: now, data: errSnap };
          throw new Error(errSnap.error ?? "Could not read Brevo quota");
        }

        let limit = parsed.limit;
        let used: number | undefined =
          limit != null ? Math.max(0, limit - parsed.remaining) : undefined;

        if (parsed.period === "month") {
          const paidUsage = await resolvePaidPlanUsage(apiKey, parsed);
          if (paidUsage.limit != null) limit = paidUsage.limit;
          if (paidUsage.used != null) used = paidUsage.used;
        }

        const okSnap: BrevoQuotaSnapshot = {
          configured: true,
          live: true,
          planType: parsed.planType,
          planLabel: parsed.planLabel,
          remaining: parsed.remaining,
          limit,
          used,
          period: parsed.period,
          periodEndsAt: parsed.periodEnd,
          accountEmail: data.email,
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
              error: "Brevo API temporarily unavailable — showing last known quota.",
              fetchedAt,
            };
          }
          return {
            configured: true,
            live: false,
            error: "Brevo API temporarily unavailable (circuit open). Try again shortly.",
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
        error:
          err instanceof Error
            ? err.message
            : "Brevo API request failed.",
        fetchedAt,
      };
    }
    const snap: BrevoQuotaSnapshot = {
      configured: true,
      live: false,
      error: err instanceof Error ? err.message : "Brevo API request failed.",
      fetchedAt,
    };
    cache = { at: now, data: snap };
    return snap;
  }
}
