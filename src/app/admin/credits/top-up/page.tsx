import { TopUpCreditsClient } from "./top-up-credits-client";
import { listActiveClientUsers } from "@/app/admin/users/actions";

export const dynamic = "force-dynamic";

export default async function TopUpCreditsPage() {
  const result = await listActiveClientUsers();
  if (!result.ok) {
    return <TopUpCreditsClient initialUsers={[]} fetchError={result.error} />;
  }
  return <TopUpCreditsClient initialUsers={result.data ?? []} />;
}
