import { updateTag } from "next/cache";
import { CACHE_TAGS } from "@/lib/cache/tags";

/** Purge tenant-wide admin dashboard fragments (Server Actions only). */
export function invalidateAdminStatsCache(): void {
  updateTag(CACHE_TAGS.adminStats);
}

/** Purge shared announcement list fragments (Server Actions only). */
export function invalidateAnnouncementsCache(): void {
  updateTag(CACHE_TAGS.announcements);
}
