import {
  listUserActivityBatches,
  searchUsersForActivity,
  type UserActivityBatchRow,
} from "./actions";
import { UserActivityClient } from "./user-activity-client";

export const dynamic = "force-dynamic";

type SearchParams = Promise<{ userId?: string; date?: string }>;

function todayYmd(): string {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

export default async function UserActivityPage({
  searchParams,
}: {
  searchParams: SearchParams;
}) {
  const sp = await searchParams;
  const userId = sp.userId?.trim() ?? "";
  const dateYmd = sp.date?.trim() || todayYmd();

  const usersResult = await searchUsersForActivity("");
  const users = usersResult.ok ? (usersResult.data ?? []) : [];

  let batches: UserActivityBatchRow[] = [];
  let fetchError: string | undefined;

  if (!usersResult.ok) {
    fetchError = usersResult.error;
  } else if (userId) {
    const batchResult = await listUserActivityBatches({ userId, dateYmd });
    if (!batchResult.ok) {
      fetchError = batchResult.error;
    } else {
      batches = batchResult.data ?? [];
    }
  }

  return (
    <UserActivityClient
      users={users}
      batches={batches ?? []}
      selectedUserId={userId}
      selectedDate={dateYmd}
      fetchError={fetchError}
    />
  );
}
