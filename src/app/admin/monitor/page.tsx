import { listMonitorCampaigns } from "./actions";
import { MonitorClient } from "./monitor-client";

export const dynamic = "force-dynamic";

type SearchParams = Promise<{ client?: string }>;

export default async function SendingMonitorPage({
  searchParams,
}: {
  searchParams: SearchParams;
}) {
  const sp = await searchParams;
  const clientId = sp.client?.trim() ?? "";
  const result = await listMonitorCampaigns();

  if (!result.ok) {
    return <MonitorClient rows={[]} clientId={clientId} fetchError={result.error} />;
  }

  return <MonitorClient rows={result.data ?? []} clientId={clientId} />;
}
