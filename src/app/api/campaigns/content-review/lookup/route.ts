import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/admin";
import {
  attachmentListFingerprint,
  issueGenuinenessPassToken,
  messageBodyContentFingerprint,
  messageContentFingerprint,
} from "@/lib/content-genuineness";
import { getVerificationResult } from "@/lib/content-genuineness/verification-store";
import { z } from "zod";
import { formatZodError } from "@/lib/validation";

export const dynamic = "force-dynamic";

const attachmentSchema = z.object({
  filename: z.string().max(500),
  contentBase64: z.string().max(8_000_000).optional(),
  htmlText: z.string().max(500_000).optional(),
});

const bodySchema = z.object({
  subject: z.string().max(998),
  body_html: z.string().max(500_000),
  sender_name: z.string().max(80),
  attachments: z.array(attachmentSchema).max(5).optional(),
});

/** Look up persisted verification for the current content hash (no Gemini re-run). */
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

  const attachments = (parsed.data.attachments ?? []).map((a) => ({
    filename: a.filename,
    contentBase64: a.contentBase64,
    htmlText: a.htmlText,
  }));

  const attFp = attachmentListFingerprint(attachments);
  const bodyFingerprint = messageBodyContentFingerprint({
    subject: parsed.data.subject,
    bodyHtml: parsed.data.body_html,
    senderName: parsed.data.sender_name,
  });
  const contentFingerprint = messageContentFingerprint({
    subject: parsed.data.subject,
    bodyHtml: parsed.data.body_html,
    senderName: parsed.data.sender_name,
    attachmentFingerprint: attFp,
  });

  let service;
  try {
    service = createServiceClient();
  } catch {
    service = supabase;
  }

  const stored = await getVerificationResult(service, user.id, contentFingerprint);

  if (!stored) {
    return NextResponse.json({
      found: false,
      contentFingerprint,
      status: "unverified" as const,
    });
  }

  const passToken =
    stored.passed
      ? issueGenuinenessPassToken({
          userId: user.id,
          fingerprint: bodyFingerprint,
          attachmentFingerprint: attFp,
        })
      : null;

  return NextResponse.json({
    found: true,
    contentFingerprint,
    status: stored.passed ? ("passed" as const) : ("failed" as const),
    passed: stored.passed,
    passToken,
    summary: stored.summary,
    phishingVerdict: stored.phishingVerdict,
    feedback: stored.feedback,
    issues: stored.feedback.map((f) => ({
      code: f.category,
      message: f.message,
      locationHint: f.locationHint,
    })),
    verifiedAt: stored.verifiedAt,
  });
}
