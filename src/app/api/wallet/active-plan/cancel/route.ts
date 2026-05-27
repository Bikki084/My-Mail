import { NextResponse } from "next/server";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/admin";
import { cancelActivePlanForUser } from "@/lib/wallet-plan-cancel";

export async function POST() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Not signed in." }, { status: 401 });
  }

  let admin;
  try {
    admin = createServiceClient();
  } catch {
    return NextResponse.json(
      {
        error:
          "Server is missing SUPABASE_SERVICE_ROLE_KEY. Add it to .env.local.",
      },
      { status: 503 },
    );
  }

  const { data: profile, error: profileErr } = await admin
    .from("profiles")
    .select("role")
    .eq("id", user.id)
    .maybeSingle();

  if (profileErr) {
    return NextResponse.json({ error: profileErr.message }, { status: 500 });
  }
  if (!profile || profile.role !== "client") {
    return NextResponse.json(
      { error: "Only client accounts can cancel plans." },
      { status: 403 },
    );
  }

  const result = await cancelActivePlanForUser(admin, user.id);
  if (!result.ok) {
    return NextResponse.json(
      { error: result.error },
      { status: result.status ?? 400 },
    );
  }

  revalidatePath("/client");
  revalidatePath("/client/overview");

  return NextResponse.json({
    ok: true,
    wallet: result.state,
    cancelledCampaigns: result.cancelledCampaigns,
  });
}
