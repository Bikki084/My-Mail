import { mergeTagSyntax } from "@/lib/merge-tags";

const TAG_KEY_RE = /^[\w.-]{1,64}$/;

/** Sanitize client-provided merge tag keys for AI prompts. */
export function normalizeMergeTagKeys(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const item of raw) {
    if (typeof item !== "string") continue;
    const key = item.trim();
    if (!TAG_KEY_RE.test(key)) continue;
    const lower = key.toLowerCase();
    if (seen.has(lower)) continue;
    seen.add(lower);
    out.push(key);
    if (out.length >= 40) break;
  }
  return out;
}

/** Prompt block listing available personalization tags for Gemini. */
export function mergeTagsPromptSection(keys: string[]): string {
  if (!keys.length) {
    return `Available merge tags: (none provided)
- Do not invent merge tags. If you need a greeting, use a generic "Hi," without a name placeholder.`;
  }

  const listed = keys.map((k) => `- ${mergeTagSyntax(k)}`).join("\n");
  const hasName = keys.some((k) => k.toLowerCase() === "name");
  const hasEmail = keys.some((k) => k.toLowerCase() === "email");

  return `Available merge tags from the recipient CSV / built-in fields (use EXACTLY this triple-brace syntax):
${listed}

Personalization rules:
- Prefer greeting with ${hasName ? mergeTagSyntax(keys.find((k) => k.toLowerCase() === "name")!) : "a generic Hi,"} when writing a body.
${hasEmail ? `- You may reference the recipient mailbox as ${mergeTagSyntax(keys.find((k) => k.toLowerCase() === "email")!)} when relevant (e.g. confirming where something was sent).` : "- No email column tag was provided."}
- Only use tags from the list above — never invent new placeholders.
- Keep tags exactly as {{{tag}}} (three braces). Do not use {{tag}} or {{ tag }}.
- Preserve any merge tags already present in the user's draft.`;
}
