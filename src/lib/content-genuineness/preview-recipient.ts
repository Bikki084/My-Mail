import type { RecipientRow } from "@/lib/merge-tags";
import {
  DEFAULT_BUILT_IN_MERGE_TAGS,
  generateBuiltInFieldsForRecipient,
} from "@/lib/built-in-merge-tags";

/** Preview recipient used to expand merge tags during consistency validation. */
export function buildPreviewRecipientRow(email?: string | null): RecipientRow {
  const norm = (email ?? "preview@example.com").trim().toLowerCase() || "preview@example.com";
  const builtIn = generateBuiltInFieldsForRecipient(norm, DEFAULT_BUILT_IN_MERGE_TAGS);
  return {
    email: norm,
    name: "Preview User",
    fields: builtIn,
  };
}
