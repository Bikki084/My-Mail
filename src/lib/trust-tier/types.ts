export type TrustTier = "new" | "warming" | "established" | "restricted";

export type TrustTierStatus = {
  tier: TrustTier;
  dailyLimit: number;
  sentToday: number;
  remainingToday: number;
  tierUpdatedAt: string;
  accountCreatedAt: string;
};

export type TrustTierHistoryRow = {
  id: string;
  user_id: string;
  from_tier: string | null;
  to_tier: string;
  reason: string;
  metrics: Record<string, unknown> | null;
  created_at: string;
};
