import { listMonitorCampaigns } from "./actions";
import { MonitorClient } from "./monitor-client";

export const dynamic = "force-dynamic";

type SearchParams = Promise<{ client?: string; page?: string }>;

export default async function SendingMonitorPage({
  searchParams,
}: {
  searchParams: SearchParams;
}) {
  const sp = await searchParams;
  const clientId = sp.client?.trim() ?? "";
  const page = Math.max(1, Number.parseInt(sp.page ?? "1", 10) || 1);
  const result = await listMonitorCampaigns();

  if (!result.ok) {
    return (
      <MonitorClient rows={[]} clientId={clientId} page={page} fetchError={result.error} />
    );
  }

  return <MonitorClient rows={result.data ?? []} clientId={clientId} page={page} />;
}
