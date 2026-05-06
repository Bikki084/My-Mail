import { listAnnouncements } from "./actions";
import { AnnouncementsClient } from "./announcements-client";

export const dynamic = "force-dynamic";

export default async function AnnouncementsPage() {
  const result = await listAnnouncements();
  if (!result.ok) {
    return <AnnouncementsClient rows={[]} fetchError={result.error} />;
  }
  return <AnnouncementsClient rows={result.data ?? []} />;
}
