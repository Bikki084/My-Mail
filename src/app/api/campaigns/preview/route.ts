import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { buildCampaignStorageHtml } from "@/lib/campaign-email-body-build";
import {
  campaignPreviewPayloadSchema,
  formatZodError,
} from "@/lib/validation";

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

  const parsed = campaignPreviewPayloadSchema.safeParse(meta);
  if (!parsed.success) {
    return NextResponse.json({ error: formatZodError(parsed.error) }, { status: 400 });
  }

  const built = await buildCampaignStorageHtml({
    rawHtml: parsed.data.body_html ?? "",
  });

  const previewToRaw = (parsed.data.preview_to ?? "").trim();
  const previewTo =
    previewToRaw && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(previewToRaw)
      ? previewToRaw.toLowerCase()
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
