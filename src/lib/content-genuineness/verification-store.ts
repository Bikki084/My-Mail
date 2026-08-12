import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { genuinenessPassTokenTtlMinutes } from "@/lib/anti-spam-config";
import { issueGenuinenessPassToken } from "@/lib/content-genuineness/pass-token";
import type { PhishingVerdictPublic } from "@/lib/content-genuineness/types";

export type StoredVerificationRecord = {
  contentFingerprint: string;
  passed: boolean;
  summary: string;
  phishingVerdict: PhishingVerdictPublic | null;
  feedback: { category: string; message: string; locationHint?: string }[];
  verifiedAt: string;
  passToken: string | null;
};

function withinPassTtl(verifiedAtIso: string): boolean {
  const verifiedAt = Date.parse(verifiedAtIso);
  if (!Number.isFinite(verifiedAt)) return false;
  const ttlMs = genuinenessPassTokenTtlMinutes() * 60_000;
  return Date.now() - verifiedAt <= ttlMs;
}

export async function upsertVerificationResult(
  supabase: SupabaseClient,
  input: {
    userId: string;
    contentFingerprint: string;
    passed: boolean;
    summary: string;
    phishingVerdict: PhishingVerdictPublic;
    feedback: { category: string; message: string; locationHint?: string }[];
  },
): Promise<void> {
  const now = new Date().toISOString();
  const { error } = await supabase.from("content_verification_results").upsert(
    {
      user_id: input.userId,
      content_fingerprint: input.contentFingerprint.slice(0, 128),
      passed: input.passed,
      summary: input.summary.slice(0, 4000),
      phishing_verdict: input.phishingVerdict,
      feedback: input.feedback,
      verified_at: now,
      updated_at: now,
    },
    { onConflict: "user_id,content_fingerprint" },
  );
  if (error) {
    console.warn("[verification-store] upsert failed:", error.message);
  }
}

export async function getVerificationResult(
  supabase: SupabaseClient,
  userId: string,
  contentFingerprint: string,
): Promise<StoredVerificationRecord | null> {
  const { data, error } = await supabase
    .from("content_verification_results")
    .select("content_fingerprint, passed, summary, phishing_verdict, feedback, verified_at")
    .eq("user_id", userId)
    .eq("content_fingerprint", contentFingerprint.slice(0, 128))
    .maybeSingle();

  if (error || !data) return null;

  const verifiedAt =
    typeof data.verified_at === "string" ? data.verified_at : new Date().toISOString();
  const storedPassed = Boolean(data.passed);

  if (storedPassed && !withinPassTtl(verifiedAt)) {
    return null;
  }

  const passToken =
    storedPassed
      ? issueGenuinenessPassToken({ userId, fingerprint: data.content_fingerprint })
      : null;

  return {
    contentFingerprint: data.content_fingerprint,
    passed: storedPassed,
    summary: String(data.summary ?? ""),
    phishingVerdict: (data.phishing_verdict as PhishingVerdictPublic | null) ?? null,
    feedback: Array.isArray(data.feedback)
      ? (data.feedback as { category: string; message: string; locationHint?: string }[])
      : [],
    verifiedAt,
    passToken,
  };
}
