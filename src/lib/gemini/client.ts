import "server-only";

/** Retired / broken aliases → current Flash models. */
const MODEL_ALIASES: Record<string, string> = {
  "gemini-2.0-flash": "gemini-2.5-flash",
  "gemini-2.0-flash-001": "gemini-2.5-flash",
  "gemini-2.0-flash-exp": "gemini-2.5-flash",
  "gemini-2.0-flash-lite": "gemini-2.5-flash-lite",
  "gemini-2.0-flash-lite-001": "gemini-2.5-flash-lite",
  "gemini-flash-latest": "gemini-2.5-flash",
};

/** Tried in order when the preferred model returns 404 / NOT_FOUND. */
const FALLBACK_MODELS = [
  "gemini-2.5-flash",
  "gemini-3.5-flash",
  "gemini-3.1-flash-lite",
  "gemini-2.5-flash-lite",
] as const;

export const DEFAULT_GEMINI_CONTENT_REVIEW_MODEL = "gemini-2.5-flash";

/** Dynamic env read so Next cannot bake an empty/stale value into the build. */
function envGet(name: string): string {
  const bag = process.env as Record<string, string | undefined>;
  return (bag[name] ?? "").trim();
}

export function resolveGeminiApiKey(): string | null {
  const key = envGet("GEMINI_API_KEY") || envGet("GOOGLE_GENERATIVE_AI_API_KEY");
  return key.length > 0 ? key : null;
}

function normalizeModelId(raw: string): string {
  let m = raw.trim();
  if (m.toLowerCase().startsWith("models/")) m = m.slice("models/".length);
  const mapped = MODEL_ALIASES[m.toLowerCase()];
  return mapped ?? m;
}

/** Preferred model + unique fallbacks (retired IDs remapped). */
export function resolveGeminiModelCandidates(): string[] {
  const preferred = normalizeModelId(
    envGet("GEMINI_CONTENT_REVIEW_MODEL") || DEFAULT_GEMINI_CONTENT_REVIEW_MODEL,
  );
  const out: string[] = [];
  const push = (id: string) => {
    const n = normalizeModelId(id);
    if (n && !out.includes(n)) out.push(n);
  };
  push(preferred);
  for (const id of FALLBACK_MODELS) push(id);
  return out;
}

export type GeminiGenerateResult =
  | { ok: true; text: string; model: string }
  | { ok: false; reason: string };

function extractText(data: unknown): string {
  const d = data as {
    candidates?: { content?: { parts?: { text?: string }[] } }[];
  };
  const parts = d.candidates?.[0]?.content?.parts ?? [];
  return parts.map((p) => p.text ?? "").join("").trim();
}

function isModelMissingError(status: number, body: string): boolean {
  if (status !== 404) return false;
  const lower = body.toLowerCase();
  return (
    lower.includes("no longer available") ||
    lower.includes("not found") ||
    lower.includes("not_found") ||
    lower.includes("is not found")
  );
}

/**
 * Call Gemini generateContent with model fallbacks and thinking disabled
 * (avoids empty JSON when thinking tokens eat the budget).
 */
export async function generateGeminiJsonText(prompt: string): Promise<GeminiGenerateResult> {
  const apiKey = resolveGeminiApiKey();
  if (!apiKey) {
    return { ok: false, reason: "GEMINI_API_KEY not configured." };
  }

  const models = resolveGeminiModelCandidates();
  let lastReason = "Gemini request failed.";

  for (const model of models) {
    // Prefer thinkingBudget:0 so Flash “thinking” models don’t return empty JSON.
    // Retry without it if the model rejects the field.
    for (const withThinking of [true, false]) {
      const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(apiKey)}`;
      const generationConfig: Record<string, unknown> = {
        temperature: 0.3,
        maxOutputTokens: 8192,
        responseMimeType: "application/json",
      };
      if (withThinking) {
        generationConfig.thinkingConfig = { thinkingBudget: 0 };
      }

      try {
        const res = await fetch(url, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          signal: AbortSignal.timeout(60_000),
          body: JSON.stringify({
            contents: [{ role: "user", parts: [{ text: prompt }] }],
            generationConfig,
          }),
        });

        if (!res.ok) {
          const errText = await res.text().catch(() => "");
          lastReason = `Gemini API error ${res.status} (${model}): ${errText.slice(0, 220)}`;
          if (isModelMissingError(res.status, errText)) break;
          if (
            withThinking &&
            (res.status === 400 || res.status === 404) &&
            /thinking/i.test(errText)
          ) {
            continue;
          }
          // Auth / quota: stop immediately
          if (res.status === 401 || res.status === 403 || res.status === 429) {
            return { ok: false, reason: lastReason };
          }
          if (!withThinking) break;
          continue;
        }

        const data: unknown = await res.json();
        const text = extractText(data);
        if (!text) {
          lastReason = `Gemini returned an empty response (${model}).`;
          if (withThinking) continue;
          break;
        }
        return { ok: true, text, model };
      } catch (e) {
        lastReason = e instanceof Error ? e.message : String(e);
        if (!withThinking) break;
      }
    }
  }

  return { ok: false, reason: lastReason };
}
