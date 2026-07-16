import { listAnnouncements } from "./actions";
import { AnnouncementsClient } from "./announcements-client";

/** Shared announcement list is Data Cache tagged; auth still runs per request. */
export const revalidate = 60;

export default async function AnnouncementsPage() {
  const result = await listAnnouncements();
  if (!result.ok) {
    return <AnnouncementsClient rows={[]} fetchError={result.error} />;
  }
  return <AnnouncementsClient rows={result.data ?? []} />;
}
