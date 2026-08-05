import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { reviewCampaignContent } from "@/lib/content-spam-review";
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

  const result = await reviewCampaignContent({
    subject: parsed.data.subject,
    bodyHtml: parsed.data.body_html,
    senderName: parsed.data.sender_name,
    useAi: parsed.data.use_ai,
  });

  return NextResponse.json(result);
}
