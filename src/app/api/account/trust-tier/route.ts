import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getTrustTierStatus } from "@/lib/trust-tier/service";

export const dynamic = "force-dynamic";

export async function GET() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const status = await getTrustTierStatus(supabase, user.id);
  if (!status) {
    return NextResponse.json({ error: "Profile not found" }, { status: 404 });
  }

  return NextResponse.json({ trustTier: status });
}
