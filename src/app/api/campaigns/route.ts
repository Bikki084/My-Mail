import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import type { RecipientRow } from "@/lib/merge-tags";
import { htmlToPlainText } from "@/lib/html-email";
import { coerceEncodingInput } from "@/lib/mail-encoding";
import { buildCampaignStorageHtml } from "@/lib/campaign-email-body-build";
import {
  MAX_CAMPAIGN_ATTACHMENTS,
  normalizedAttachmentsFromMultipart,
} from "@/lib/campaign-multipart";
import { requireActivePlanForMailOrJson } from "@/lib/active-plan-guard";
import {
  campaignCreateBodySchema,
  campaignFieldsSchema,
  formatZodError,
  htmlAttachmentPayloadSchema,
} from "@/lib/validation";
import type { z } from "zod";

const MAX_ATTACHMENTS = MAX_CAMPAIGN_ATTACHMENTS;

function normalizeHtmlAttachment(
  raw: z.infer<typeof htmlAttachmentPayloadSchema> | null | undefined,
): { kind: "pdf" | "png" | "jpeg" | "pdf_image"; html: string } | null {
  if (!raw) return null;
  const html = raw.html.trim();
  if (!html) return null;
  return { kind: raw.kind, html };
}

export async function GET() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const { data, error } = await supabase
    .from("campaigns")
    .select("*")
    .eq("user_id", user.id)
    .order("created_at", { ascending: false });
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json({ campaigns: data });
}

export async function POST(req: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  /** Composer send flow sets this so draft saves (no header) still work without a plan. */
  const intentSend = req.headers.get("x-mymail-intent") === "send";
  if (intentSend) {
    const planBlock = await requireActivePlanForMailOrJson(supabase, user.id);
    if (planBlock) return planBlock;
  }

  const contentType = (req.headers.get("content-type") || "").toLowerCase();
  let row: RecipientRow[] = [];
  let rest!: Omit<z.infer<typeof campaignFieldsSchema>, "recipients">;
  let smtp_server_ids: string[] | undefined;
  let normalizedAttachments: { filename: string; contentBase64: string }[] = [];

  if (contentType.includes("multipart/form-data")) {
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
      return NextResponse.json(
        { error: 'Form field "payload" (JSON) is required for multipart create.' },
        { status: 400 },
      );
    }
    let meta: unknown;
    try {
      meta = JSON.parse(rawPayload) as unknown;
    } catch {
      return NextResponse.json({ error: 'Invalid JSON in "payload".' }, { status: 400 });
    }
    const parsed = campaignFieldsSchema.safeParse(meta);
    if (!parsed.success) {
      return NextResponse.json({ error: formatZodError(parsed.error) }, { status: 400 });
    }
    const expRaw = req.headers.get("x-mymail-expected-files");
    const nParsed = parseInt(String(expRaw ?? "0"), 10);
    const expectedFileCount =
      Number.isFinite(nParsed) && nParsed >= 0 ? Math.min(MAX_ATTACHMENTS, nParsed) : 0;
    const fromFiles = await normalizedAttachmentsFromMultipart(form, expectedFileCount);
    if (!fromFiles.ok) {
      return NextResponse.json({ error: fromFiles.message }, { status: 400 });
    }
    normalizedAttachments = fromFiles.rows;
    row = parsed.data.recipients;
    const { recipients: _r, smtp_server_ids: smtp, ...r } = parsed.data;
    void _r;
    smtp_server_ids = smtp;
    rest = r;
  } else {
    const json = await req.json().catch(() => null);
    const parsed = campaignCreateBodySchema.safeParse(json);
    if (!parsed.success) {
      return NextResponse.json({ error: formatZodError(parsed.error) }, { status: 400 });
    }
    const p = parsed.data;
    const { recipients, smtp_server_ids: smtp, attachments, ...r } = p;
    row = recipients;
    smtp_server_ids = smtp;
    rest = r;
    normalizedAttachments = attachments ?? [];
  }

  const encPersist = coerceEncodingInput(rest.encoding ?? "auto");
  const rawHtml = (rest.body_html ?? "").trim();
  const hasAtt = normalizedAttachments.length > 0;
  const htmlAttachment = normalizeHtmlAttachment(rest.html_attachment ?? null);
  const hasHtmlAtt = htmlAttachment != null;
  if (!rawHtml && !hasAtt && !hasHtmlAtt) {
    return NextResponse.json(
      { error: "Email content (HTML) is required" },
      { status: 400 },
    );
  }
  const built = await buildCampaignStorageHtml({
    rawHtml: rest.body_html ?? "",
  });
  const finalHtml = built.finalHtml;
  const autoText = finalHtml ? htmlToPlainText(finalHtml) : "";

  const { data, error } = await supabase
    .from("campaigns")
    .insert({
      user_id: user.id,
      stream_name: rest.stream_name,
      subject: rest.subject ?? null,
      sender_name: rest.sender_name ?? null,
      body_html: finalHtml || null,
      body_text: autoText || null,
      encoding: encPersist,
      smtp_server_ids: smtp_server_ids ?? [],
      rotation_strategy: rest.rotation_strategy ?? "round_robin",
      attachment_paths: normalizedAttachments,
      html_attachment: htmlAttachment,
      recipients: row,
      total_emails: row.length,
      status: "draft",
    })
    .select("id, attachment_paths, smtp_server_ids")
    .single();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const requestedSmtpIds = (smtp_server_ids ?? []).length;
  const storedSmtpIds = Array.isArray(data.smtp_server_ids)
    ? data.smtp_server_ids.length
    : 0;
  if (requestedSmtpIds > 0 && storedSmtpIds !== requestedSmtpIds) {
    console.error(
      `[api/campaigns] smtp_server_ids count mismatch after insert: requested ${requestedSmtpIds}, stored ${storedSmtpIds} for campaign ${data.id}`,
    );
  }
  if (normalizedAttachments.length > 0) {
    const saved = data.attachment_paths;
    if (!Array.isArray(saved) || saved.length !== normalizedAttachments.length) {
      return NextResponse.json(
        {
          error:
            "Attachments were not stored correctly (count mismatch). Try a smaller file or retry.",
        },
        { status: 500 },
      );
    }
    for (let i = 0; i < saved.length; i++) {
      const row2 = saved[i] as { contentBase64?: unknown; filename?: unknown };
      const b64 = typeof row2.contentBase64 === "string" ? row2.contentBase64 : "";
      if (!b64 || b64.length < 8) {
        console.error(
          `[api/campaigns] attachment ${i} stored with empty contentBase64 for campaign ${data.id}; expected ~${normalizedAttachments[i]?.contentBase64.length ?? 0} chars`,
        );
        return NextResponse.json(
          {
            error:
              "Attachment content was not saved. This is usually a Supabase row-size / body-size limit. Try a smaller file.",
          },
          { status: 500 },
        );
      }
    }
    console.log(
      `[api/campaigns] created campaign ${data.id} with ${saved.length} attachment(s): ${saved
        .map((r) =>
          typeof (r as { filename?: unknown }).filename === "string"
            ? (r as { filename: string }).filename
            : "?",
        )
        .join(", ")}`,
    );
  }

  return NextResponse.json({
    id: data.id,
    attachmentCount: normalizedAttachments.length,
    warnings: built.warnings.length > 0 ? built.warnings : undefined,
  });
}
