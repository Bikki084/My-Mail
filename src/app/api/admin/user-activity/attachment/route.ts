import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import type { RecipientRow } from "@/lib/merge-tags";
import { resolveActivityAttachmentBuffer } from "@/lib/user-activity-attachments";

async function assertAdmin(): Promise<{ ok: true } | { ok: false; status: number; error: string }> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, status: 401, error: "Not authenticated." };

  const { data: profile, error } = await supabase
    .from("profiles")
    .select("role")
    .eq("id", user.id)
    .maybeSingle();
  if (error) return { ok: false, status: 500, error: error.message };
  if (profile?.role !== "admin") {
    return { ok: false, status: 403, error: "Admin role required." };
  }
  return { ok: true };
}

export async function GET(req: Request) {
  const guard = await assertAdmin();
  if (!guard.ok) {
    return NextResponse.json({ error: guard.error }, { status: guard.status });
  }

  const url = new URL(req.url);
  const campaignId = url.searchParams.get("campaignId")?.trim() ?? "";
  const filename = url.searchParams.get("filename")?.trim() ?? "";
  const asDownload = url.searchParams.get("download") === "1";

  if (!campaignId || !filename) {
    return NextResponse.json(
      { error: "campaignId and filename are required." },
      { status: 400 },
    );
  }

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("user_activity_snapshots")
    .select("attachments, html_attachment, sample_recipient")
    .eq("campaign_id", campaignId)
    .maybeSingle();
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  if (!data) {
    return NextResponse.json({ error: "Snapshot not found or expired." }, { status: 404 });
  }

  const sample = (data.sample_recipient ?? {}) as RecipientRow;
  const resolved = await resolveActivityAttachmentBuffer({
    attachmentsRaw: data.attachments,
    htmlAttachmentRaw: data.html_attachment,
    sampleRecipient: sample,
    filename,
  });
  if (!resolved) {
    return NextResponse.json({ error: "Attachment not found." }, { status: 404 });
  }

  const disposition = asDownload ? "attachment" : "inline";
  const safeName = resolved.filename.replace(/[^\w.\-()+ ]/g, "_");

  return new Response(new Uint8Array(resolved.buf), {
    status: 200,
    headers: {
      "Content-Type": resolved.contentType,
      "Content-Length": String(resolved.buf.length),
      "Content-Disposition": `${disposition}; filename="${safeName}"`,
      "Cache-Control": "private, max-age=3600",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
