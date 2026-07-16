/** Next.js Data Cache tags — pair with `revalidateTag` on mutations. */
export const CACHE_TAGS = {
  adminStats: "admin-stats",
  announcements: "announcements",
  deliverabilityGuide: "deliverability-guide",
} as const;

export type CacheTag = (typeof CACHE_TAGS)[keyof typeof CACHE_TAGS];

/** Default locale bucket until i18n is wired; extend when adding translations. */
export const DEFAULT_CACHE_LOCALE = "en";
