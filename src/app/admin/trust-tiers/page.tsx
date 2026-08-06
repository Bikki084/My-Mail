import { TrustTiersClient } from "./trust-tiers-client";
import { fetchAdminTrustTierRows } from "./actions";

export const dynamic = "force-dynamic";

export default async function AdminTrustTiersPage() {
  const rows = await fetchAdminTrustTierRows();
  return <TrustTiersClient rows={rows} />;
}
