import { unstable_cache } from "next/cache";
import { headers } from "next/headers";
import { DEFAULT_CACHE_LOCALE } from "@/lib/cache/tags";

type CacheOptions = {
  revalidate?: number;
  tags?: string[];
};

/**
 * Resolve a coarse locale bucket for cache keys (Accept-Language prefix).
 * Falls back to `DEFAULT_CACHE_LOCALE` when the header is absent.
 */
export async function resolveCacheLocale(): Promise<string> {
  try {
    const h = await headers();
    const raw = h.get("accept-language")?.split(",")[0]?.trim().toLowerCase();
    if (!raw) return DEFAULT_CACHE_LOCALE;
    const primary = raw.split("-")[0];
    return primary && primary.length >= 2 ? primary : DEFAULT_CACHE_LOCALE;
  } catch {
    return DEFAULT_CACHE_LOCALE;
  }
}

/**
 * Cache a server fragment fetch. Locale is part of the cache key so future
 * translations do not bleed across locales.
 */
export function cachedFragment<T>(
  keyParts: readonly string[],
  fn: () => Promise<T>,
  options?: CacheOptions,
): () => Promise<T> {
  return unstable_cache(fn, [...keyParts], {
    revalidate: options?.revalidate ?? 60,
    tags: options?.tags,
  });
}
