import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/admin";
import {
  reviewCampaignContent,
  toPublicContentReviewResult,
} from "@/lib/content-spam-review";
import {
  assertContentRescoreAllowed,
  contentReviewFingerprint,
} from "@/lib/content-spam-review/rescore-limit";
import { validateCampaignComposeRequired } from "@/lib/campaign-compose-validation";
import { validateContentQuality } from "@/lib/content-quality-validation";
import { logContentRejection, logContentRescoreAttempt } from "@/lib/anti-spam-audit";
import { z } from "zod";
import { formatZodError } from "@/lib/validation";

export const dynamic = "force-dynamic";

const bodySchema = z.object({
  subject: z.string().max(998),
  body_html: z.string().max(500_000),
  sender_name: z.string().max(80),
  use_ai: z.boolean().optional(),
});

export async function POST(req: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const json = await req.json().catch(() => null);
  const parsed = bodySchema.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json({ error: formatZodError(parsed.error) }, { status: 400 });
  }

  const compose = validateCampaignComposeRequired({
    senderName: parsed.data.sender_name,
    subject: parsed.data.subject,
    bodyHtml: parsed.data.body_html,
  });
  if (!compose.ok) {
    void logContentRejection(supabase, {
      userId: user.id,
      reasonCode: "compose_required",
      message: compose.message,
    });
    return NextResponse.json({ error: compose.message, blocked: true }, { status: 400 });
  }

  const quality = validateContentQuality({ bodyHtml: parsed.data.body_html });
  if (!quality.ok) {
    void logContentRejection(supabase, {
      userId: user.id,
      reasonCode: quality.code,
      message: quality.message,
      metadata: {
        wordCount: quality.wordCount,
        minWords: quality.minWords,
      },
    });
    return NextResponse.json({ error: quality.message, blocked: true }, { status: 400 });
  }

  const fingerprint = contentReviewFingerprint({
    subject: parsed.data.subject,
    bodyHtml: parsed.data.body_html,
    senderName: parsed.data.sender_name,
  });

  let service;
  try {
    service = createServiceClient();
  } catch {
    service = supabase;
  }

  const rateLimit = await assertContentRescoreAllowed(service, user.id, fingerprint);
  if (!rateLimit.ok) {
    void logContentRescoreAttempt(service, {
      userId: user.id,
      contentFingerprint: fingerprint,
      riskLevel: "rate_limited",
      blocked: true,
    });
    return NextResponse.json(
      { error: rateLimit.message, blocked: true, retryAfterMinutes: rateLimit.retryAfterMinutes },
      { status: 429 },
    );
  }

  const result = await reviewCampaignContent({
    subject: parsed.data.subject,
    bodyHtml: parsed.data.body_html,
    senderName: parsed.data.sender_name,
    useAi: parsed.data.use_ai,
  });

  void logContentRescoreAttempt(service, {
    userId: user.id,
    contentFingerprint: fingerprint,
    riskLevel: result.riskLevel,
    blocked: false,
  });

  return NextResponse.json(
    toPublicContentReviewResult(result, { rescoringRemaining: rateLimit.remaining }),
  );
}
