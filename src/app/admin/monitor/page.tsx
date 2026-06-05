import { listMonitorCampaigns } from "./actions";
import { MonitorClient } from "./monitor-client";

export const dynamic = "force-dynamic";

export default async function SendingMonitorPage() {
  const result = await listMonitorCampaigns();

  if (!result.ok) {
    return <MonitorClient rows={[]} fetchError={result.error} />;
  }

  return <MonitorClient rows={result.data ?? []} />;
}
