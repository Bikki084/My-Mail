import { listLoginHistory } from "./actions";
import { LoginHistoryClient } from "./login-history-client";

export const dynamic = "force-dynamic";

type SearchParams = Promise<{
  userId?: string;
  from?: string;
  to?: string;
  page?: string;
}>;

export default async function LoginHistoryPage({
  searchParams,
}: {
  searchParams: SearchParams;
}) {
  const sp = await searchParams;
  const page = sp.page ? Math.max(1, parseInt(sp.page, 10) || 1) : 1;

  const result = await listLoginHistory({
    userId: sp.userId || undefined,
    from: sp.from || undefined,
    to: sp.to || undefined,
    page,
    pageSize: 25,
  });

  if (!result.ok) {
    return (
      <LoginHistoryClient
        rows={[]}
        total={0}
        page={1}
        pageSize={25}
        users={[]}
        filters={{ userId: sp.userId ?? "", from: sp.from ?? "", to: sp.to ?? "" }}
        fetchError={result.error}
      />
    );
  }

  const data = result.data!;
  return (
    <LoginHistoryClient
      rows={data.rows}
      total={data.total}
      page={data.page}
      pageSize={data.pageSize}
      users={data.users}
      filters={{ userId: sp.userId ?? "", from: sp.from ?? "", to: sp.to ?? "" }}
    />
  );
}
