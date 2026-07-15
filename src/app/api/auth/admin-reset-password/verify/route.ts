import { NextResponse, type NextRequest } from "next/server";
import { createServiceClient } from "@/lib/supabase/admin";
import {
  equalTokenHashes,
  hashAdminResetToken,
} from "@/lib/admin-reset-token";
import { adminResetVerifyQuerySchema } from "@/lib/validation";

const noStore = { headers: { "Cache-Control": "no-store" } } as const;

export async function GET(request: NextRequest) {
  const parsed = adminResetVerifyQuerySchema.safeParse({
    token: request.nextUrl.searchParams.get("token"),
  });
  if (!parsed.success) {
    return NextResponse.json({ valid: false as const }, noStore);
  }
  const token = parsed.data.token;

  try {
    const supabase = createServiceClient();
    const tokenHash = hashAdminResetToken(token);

    const { data: row, error } = await supabase
      .from("profiles")
      .select("id, reset_token, reset_token_expiry, role")
      .eq("role", "admin")
      .maybeSingle();

    if (error || !row?.reset_token || !row.reset_token_expiry) {
      return NextResponse.json({ valid: false as const }, noStore);
    }

    if (!equalTokenHashes(row.reset_token, tokenHash)) {
      return NextResponse.json({ valid: false as const }, noStore);
    }

    const exp = new Date(row.reset_token_expiry).getTime();
    if (!Number.isFinite(exp) || exp <= Date.now()) {
      return NextResponse.json({ valid: false as const }, noStore);
    }

    return NextResponse.json({ valid: true as const }, noStore);
  } catch {
    return NextResponse.json({ valid: false as const }, noStore);
  }
}
