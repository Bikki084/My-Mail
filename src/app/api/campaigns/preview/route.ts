import { NextResponse } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { buildCampaignStorageHtml } from "@/lib/campaign-email-body-build";
import { MAX_CAMPAIGN_ATTACHMENTS } from "@/lib/campaign-multipart";

const htmlAttachmentPayloadSchema = z.object({
  kind: z.enum(["pdf", "png", "jpeg"]),
  html: z.string().max(500_000),
});

const previewPayloadSchema = z.object({
  subject: z.union([z.string(), z.null()]).optional(),
  sender_name: z.union([z.string(), z.null()]).optional(),
  body_html: z.union([z.string(), z.null()]).optional(),
  encoding: z.string().optional(),
  preview_to: z.union([z.string(), z.null()]).optional(),
  attachment_names: z.array(z.string()).max(MAX_CAMPAIGN_ATTACHMENTS).optional(),
  html_attachment: htmlAttachmentPayloadSchema.optional().nullable(),
});

export async function POST(req: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const contentType = (req.headers.get("content-type") || "").toLowerCase();
  if (!contentType.includes("multipart/form-data")) {
    return NextResponse.json(
      { error: 'Preview requires multipart/form-data with a JSON "payload" field.' },
      { status: 400 },
    );
  }

  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return NextResponse.json(
      { error: "Invalid multipart form (body too large or corrupt)." },
      { status: 400 },
    );
  }

  const rawPayload = form.get("payload");
  if (typeof rawPayload !== "string") {
    return NextResponse.json({ error: 'Form field "payload" (JSON) is required.' }, { status: 400 });
  }

  let meta: unknown;
  try {
    meta = JSON.parse(rawPayload) as unknown;
  } catch {
    return NextResponse.json({ error: 'Invalid JSON in "payload".' }, { status: 400 });
  }

  const parsed = previewPayloadSchema.safeParse(meta);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  const built = await buildCampaignStorageHtml({
    rawHtml: parsed.data.body_html ?? "",
  });

  const previewToRaw = (parsed.data.preview_to ?? "").trim();
  const previewTo =
    previewToRaw && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(previewToRaw)
      ? previewToRaw
      : "john@example.com";

  const names = [...(parsed.data.attachment_names ?? [])];
  const ha = parsed.data.html_attachment;
  if (ha?.html?.trim()) {
    const previewName =
      ha.kind === "pdf"
        ? "attachment.pdf"
        : ha.kind === "jpeg"
          ? "attachment.jpg"
          : "attachment.png";
    names.push(previewName);
  }

  return NextResponse.json({
    finalHtml: built.finalHtml,
    warnings: built.warnings,
    truncated: built.truncated,
    subject: (parsed.data.subject ?? "").trim() || "—",
    senderName: (parsed.data.sender_name ?? "").trim() || "—",
    previewTo,
    attachmentNames: names,
  });
}
