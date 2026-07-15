import type { ZodError, ZodType } from "zod";

export type ParseResult<T> = { ok: true; data: T } | { ok: false; error: string };

/** First human-readable Zod issue — used for server actions and API 400 responses. */
export function formatZodError(error: ZodError): string {
  const issue = error.issues[0];
  if (!issue) return "Invalid input.";
  const path = issue.path.length ? `${issue.path.join(".")}: ` : "";
  return `${path}${issue.message}`;
}

/** Parse and reject anything outside the schema (no silent fixes). */
export function parseStrict<T>(schema: ZodType<T>, input: unknown): ParseResult<T> {
  const result = schema.safeParse(input);
  if (!result.success) {
    return { ok: false, error: formatZodError(result.error) };
  }
  return { ok: true, data: result.data };
}
