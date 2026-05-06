import { listUsageReports } from "./actions";
import { UsageReportsClient } from "./usage-reports-client";

export const dynamic = "force-dynamic";

type SearchParams = Promise<{
  from?: string;
  to?: string;
}>;

export default async function UsageReportsPage({
  searchParams,
}: {
  searchParams: SearchParams;
}) {
  const sp = await searchParams;
  const from = sp.from || "";
  const to = sp.to || "";

  const result = await listUsageReports({
    from: from || undefined,
    to: to || undefined,
  });

  if (!result.ok) {
    return (
      <UsageReportsClient
        rows={[]}
        filters={{ from, to }}
        fetchError={result.error}
      />
    );
  }

  return (
    <UsageReportsClient rows={result.data ?? []} filters={{ from, to }} />
  );
}
