export type RecipientValidateApiResult = {
  email: string;
  ok: boolean;
  reasonLabels: string[];
};

export type RecipientValidateApiResponse = {
  ok: boolean;
  okCount: number;
  blockedCount: number;
  results: RecipientValidateApiResult[];
};

const CHUNK_SIZE = 500;

export async function validateEmailsViaApi(
  emails: string[],
): Promise<Map<string, RecipientValidateApiResult>> {
  const out = new Map<string, RecipientValidateApiResult>();
  if (emails.length === 0) return out;

  for (let i = 0; i < emails.length; i += CHUNK_SIZE) {
    const chunk = emails.slice(i, i + CHUNK_SIZE);
    const res = await fetch("/api/recipients/validate", {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ emails: chunk }),
    });
    const j = (await res.json().catch(() => ({}))) as RecipientValidateApiResponse & {
      error?: string;
    };
    if (!res.ok) {
      throw new Error(typeof j.error === "string" ? j.error : "Validation request failed");
    }
    for (const row of j.results ?? []) {
      out.set(row.email.trim().toLowerCase(), row);
    }
  }

  return out;
}
