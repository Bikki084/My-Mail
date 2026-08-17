export type PhishingMismatch = {
  field: string;
  body_value: string;
  attachment_value: string;
};

export type PhishingVerdictJson = {
  status: "PASS" | "FAIL";
  mismatches_found: PhishingMismatch[];
  flags: string[];
  reasoning: string;
};

function normalizePhishingVerdict(parsed: Partial<PhishingVerdictJson>): PhishingVerdictJson | null {
  const statusRaw = String(parsed.status ?? "").toUpperCase();
  if (statusRaw !== "PASS" && statusRaw !== "FAIL") return null;
  return {
    status: statusRaw,
    mismatches_found: Array.isArray(parsed.mismatches_found) ? parsed.mismatches_found : [],
    flags: Array.isArray(parsed.flags) ? parsed.flags.map(String) : [],
    reasoning: String(parsed.reasoning ?? ""),
  };
}

/** Salvage PASS when Gemini truncates the reasoning string but arrays + status are intact. */
function salvageTruncatedPhishingVerdict(text: string): PhishingVerdictJson | null {
  const statusMatch = text.match(/"status"\s*:\s*"(PASS|FAIL)"/i);
  if (!statusMatch) return null;

  const status = statusMatch[1]!.toUpperCase() as "PASS" | "FAIL";
  const hasEmptyMismatches = /"mismatches_found"\s*:\s*\[\s*\]/.test(text);
  const hasEmptyFlags = /"flags"\s*:\s*\[\s*\]/.test(text);

  if (status !== "PASS" || !hasEmptyMismatches || !hasEmptyFlags) return null;

  let reasoning = "Content passed phishing verification.";
  const closedReasoning = text.match(/"reasoning"\s*:\s*"((?:[^"\\]|\\.)*)"/);
  if (closedReasoning?.[1]) {
    reasoning = closedReasoning[1].replace(/\\"/g, '"').replace(/\\n/g, " ");
  } else {
    const openReasoning = text.match(/"reasoning"\s*:\s*"([\s\S]{8,800})/);
    if (openReasoning?.[1]) reasoning = openReasoning[1].replace(/\s+/g, " ").trim();
  }

  return {
    status: "PASS",
    mismatches_found: [],
    flags: [],
    reasoning,
  };
}

function repairTruncatedJsonObject(raw: string): string | null {
  const start = raw.indexOf("{");
  if (start < 0) return null;
  let slice = raw.slice(start).trim();
  if (!slice.endsWith("}")) {
    if (/"\s*$/.test(slice) || /[^\\]"\s*$/.test(slice)) slice += '"';
    slice += "}";
  }
  return slice;
}

export function parsePhishingVerdictJson(text: string): PhishingVerdictJson | null {
  const trimmed = text.trim();
  const fence = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const raw = fence ? fence[1]!.trim() : trimmed;

  const candidates = [raw];
  const start = raw.indexOf("{");
  const end = raw.lastIndexOf("}");
  if (start >= 0 && end > start) candidates.push(raw.slice(start, end + 1));
  const repaired = repairTruncatedJsonObject(raw);
  if (repaired) candidates.push(repaired);

  for (const candidate of candidates) {
    try {
      const parsed = normalizePhishingVerdict(JSON.parse(candidate) as Partial<PhishingVerdictJson>);
      if (parsed) return parsed;
    } catch {
      // try next candidate
    }
  }

  return salvageTruncatedPhishingVerdict(raw);
}
