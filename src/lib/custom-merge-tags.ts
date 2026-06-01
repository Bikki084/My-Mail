/** User-defined merge tags with a fixed value for every recipient (not from CSV). */
export type CustomMergeTag = {
  id: string;
  key: string;
  value: string;
};

export function customTagsToFieldDefaults(
  tags: CustomMergeTag[],
): Record<string, string> {
  const out: Record<string, string> = {};
  for (const t of tags) {
    const key = t.key.trim();
    const value = t.value.trim();
    if (!key || !value) continue;
    out[key] = value;
  }
  return out;
}

/** Keys from custom tags plus CSV columns (for autocomplete / pickers). */
export function allMergeTagKeys(
  columnOrder: string[],
  customTags: CustomMergeTag[],
): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const col of columnOrder) {
    const k = col.trim();
    if (!k) continue;
    const lower = k.toLowerCase();
    if (seen.has(lower)) continue;
    seen.add(lower);
    out.push(k);
  }
  for (const t of customTags) {
    const k = t.key.trim();
    if (!k) continue;
    const lower = k.toLowerCase();
    if (seen.has(lower)) continue;
    seen.add(lower);
    out.push(k);
  }
  return out.sort((a, b) => a.localeCompare(b, undefined, { sensitivity: "base" }));
}
