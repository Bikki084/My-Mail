import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { validateRecipients, humanReason } from "@/lib/recipient-validation";
import { z } from "zod";
import { formatZodError } from "@/lib/validation";

export const dynamic = "force-dynamic";

const bodySchema = z.object({
  emails: z
    .array(z.string().max(320))
    .min(1, "At least one email is required.")
    .max(5000, "At most 5000 emails per request."),
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

  const summary = await validateRecipients(supabase, user.id, parsed.data.emails);

  return NextResponse.json({
    ok: true,
    okCount: summary.okCount,
    blockedCount: summary.blockedCount,
    results: summary.results.map((r) => ({
      email: r.email,
      ok: r.ok,
      reasons: r.reasons,
      reasonLabels: r.reasons.map(humanReason),
    })),
  });
}
