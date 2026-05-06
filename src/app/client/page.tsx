import { isClientDashboardPreviewMode } from "@/lib/auth-config";
import { createClient } from "@/lib/supabase/server";
import { EmailCampaignConsole } from "@/components/client/email-campaign/email-campaign-console";
import type { WalletState } from "@/app/actions/wallet";

export const dynamic = "force-dynamic";

const EMPTY_WALLET: WalletState = { balance: 0, activePlan: null };

function isExpired(expiresAt: string | null | undefined): boolean {
  if (!expiresAt) return false;
  const t = Date.parse(expiresAt);
  if (!Number.isFinite(t)) return false;
  return t <= Date.now();
}

export default async function ClientCampaignPage() {
  if (isClientDashboardPreviewMode()) {
    return (
      <EmailCampaignConsole
        userDisplayName="Preview (no Supabase)"
        walletState={EMPTY_WALLET}
        previewMode
      />
    );
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  let userDisplayName = "Client";
  let walletState: WalletState = EMPTY_WALLET;

  if (user) {
    const [profileRes, creditsRes, planRes] = await Promise.all([
      supabase
        .from("profiles")
        .select("full_name, email")
        .eq("id", user.id)
        .maybeSingle(),
      supabase
        .from("credits")
        .select("wallet_balance")
        .eq("user_id", user.id)
        .maybeSingle(),
      supabase
        .from("active_plans")
        .select("plan_id, servers_allowed, started_at, expires_at")
        .eq("user_id", user.id)
        .maybeSingle(),
    ]);

    const profile = profileRes.data;
    userDisplayName =
      profile?.full_name?.trim() || profile?.email || user.email || userDisplayName;

    const balance = Math.max(
      0,
      Math.floor(Number(creditsRes.data?.wallet_balance ?? 0)),
    );

    const planRow = planRes.data;
    walletState = {
      balance,
      activePlan: planRow
        ? {
            planId: planRow.plan_id,
            serversAllowed: planRow.servers_allowed,
            startedAt: planRow.started_at,
            expiresAt: planRow.expires_at,
            expired: isExpired(planRow.expires_at),
          }
        : null,
    };
  }

  return (
    <EmailCampaignConsole
      userDisplayName={userDisplayName}
      walletState={walletState}
    />
  );
}
