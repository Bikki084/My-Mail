/**
 * Server-topup plan catalog.
 *
 * A plan represents a paid time-window during which the client may use
 * a fixed number (or unlimited) of SMTP servers. The wallet balance is
 * deducted by `cost` at activation and the plan ends when `expires_at`
 * is reached, regardless of usage.
 *
 * `serversAllowed === null` means unlimited.
 */
export type Plan = {
  id: string;
  /** Cost in wallet credits. */
  cost: number;
  /** Number of SMTP servers the client can use; null = unlimited. */
  serversAllowed: number | null;
  /** Plan duration in hours. */
  durationHours: number;
  /** Short label shown in the dropdown. */
  label: string;
  /** Longer one-line description. */
  description: string;
};

export const PLANS: readonly Plan[] = [
  {
    id: "p500",
    cost: 500,
    serversAllowed: 10,
    durationHours: 3,
    label: "500 credits — 10 servers / 3 hr",
    description: "10 SMTP servers, 3-hour window.",
  },
  {
    id: "p1000",
    cost: 1000,
    serversAllowed: 30,
    durationHours: 6,
    label: "1,000 credits — 30 servers / 6 hr",
    description: "30 SMTP servers, 6-hour window.",
  },
  {
    id: "p1500",
    cost: 1500,
    serversAllowed: 50,
    durationHours: 6,
    label: "1,500 credits — 50 servers / 6 hr",
    description: "50 SMTP servers, 6-hour window.",
  },
  {
    id: "p2000",
    cost: 2000,
    serversAllowed: null,
    durationHours: 12,
    label: "2,000 credits — Unlimited servers / 12 hr",
    description: "Unlimited SMTP servers, 12-hour window.",
  },
] as const;

export function findPlan(id: string): Plan | undefined {
  return PLANS.find((p) => p.id === id);
}

export function formatServerLimit(p: Plan): string {
  return p.serversAllowed === null ? "Unlimited" : `${p.serversAllowed}`;
}
