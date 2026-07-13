import "server-only";

/** Brevo free plan daily email cap (transactional + marketing share this pool). */
export const BREVO_FREE_DAILY_LIMIT = 300;

const BREVO_ACCOUNT_URL = "https://api.brevo.com/v3/account";
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

function parseEmailSendPlan(data: BrevoAccountResponse): {
  planType: string;
  planLabel: string;
  remaining: number;
  period: "day" | "month";
  limit?: number;
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
  const limit = isFree ? BREVO_FREE_DAILY_LIMIT : undefined;

  return {
    planType,
    planLabel: marketing?.name?.trim() || labelForPlanType(planType),
    remaining,
    period,
    limit,
  };
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
      const snap: BrevoQuotaSnapshot = {
        configured: true,
        live: false,
        error: `Brevo API ${res.status}${body ? `: ${body.slice(0, 120)}` : ""}`,
        fetchedAt,
      };
      cache = { at: now, data: snap };
      return snap;
    }

    const data = (await res.json()) as BrevoAccountResponse;
    const parsed = parseEmailSendPlan(data);

    if (!parsed) {
      const snap: BrevoQuotaSnapshot = {
        configured: true,
        live: false,
        error: "Could not read email quota from Brevo account response.",
        accountEmail: data.email,
        fetchedAt,
      };
      cache = { at: now, data: snap };
      return snap;
    }

    const used =
      parsed.limit != null
        ? Math.max(0, parsed.limit - parsed.remaining)
        : undefined;

    const snap: BrevoQuotaSnapshot = {
      configured: true,
      live: true,
      planType: parsed.planType,
      planLabel: parsed.planLabel,
      remaining: parsed.remaining,
      limit: parsed.limit,
      used,
      period: parsed.period,
      accountEmail: data.email,
      fetchedAt,
    };
    cache = { at: now, data: snap };
    return snap;
  } catch (err) {
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
