import { NextResponse, type NextRequest } from "next/server";
import bcrypt from "bcryptjs";
import { createServiceClient } from "@/lib/supabase/admin";
import {
  equalTokenHashes,
  hashAdminResetToken,
} from "@/lib/admin-reset-token";
import { adminResetPasswordBodySchema, formatZodError } from "@/lib/validation";

const BCRYPT_ROUNDS = 12;

const INVALID_LINK = "Link expired or invalid";

const noStore = { headers: { "Cache-Control": "no-store" } } as const;

export async function POST(request: NextRequest) {
  let json: unknown;
  try {
    json = await request.json();
  } catch {
    return NextResponse.json({ ok: false, error: INVALID_LINK }, { status: 400, ...noStore });
  }

  const parsed = adminResetPasswordBodySchema.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json({ ok: false, error: formatZodError(parsed.error) }, { status: 400, ...noStore });
  }

  const { token, password } = parsed.data;

  try {
    const supabase = createServiceClient();
    const tokenHash = hashAdminResetToken(token);

    const { data: row, error: fetchErr } = await supabase
      .from("profiles")
      .select("id, reset_token, reset_token_expiry, role")
      .eq("role", "admin")
      .maybeSingle();

    if (fetchErr || !row?.id || !row.reset_token || !row.reset_token_expiry) {
      return NextResponse.json({ ok: false, error: INVALID_LINK }, { status: 400, ...noStore });
    }

    if (!equalTokenHashes(row.reset_token, tokenHash)) {
      return NextResponse.json({ ok: false, error: INVALID_LINK }, { status: 400, ...noStore });
    }

    const exp = new Date(row.reset_token_expiry).getTime();
    if (!Number.isFinite(exp) || exp <= Date.now()) {
      return NextResponse.json({ ok: false, error: INVALID_LINK }, { status: 400, ...noStore });
    }

    /** App policy: bcrypt the password before delegating to Supabase (GoTrue re-hashes for storage). */
    void bcrypt.hashSync(password, BCRYPT_ROUNDS);

    const { error: authErr } = await supabase.auth.admin.updateUserById(row.id, {
      password,
    });

    if (authErr) {
      console.error("[admin-reset-password] updateUserById:", authErr.message);
      return NextResponse.json(
        { ok: false, error: "Could not update password. Try again later." },
        { status: 500, ...noStore },
      );
    }

    const { error: clearErr } = await supabase
      .from("profiles")
      .update({ reset_token: null, reset_token_expiry: null })
      .eq("id", row.id);

    if (clearErr) {
      console.error("[admin-reset-password] clear token:", clearErr.message);
    }

    return NextResponse.json({ ok: true as const }, noStore);
  } catch (e) {
    console.error("[admin-reset-password]", e);
    return NextResponse.json(
      { ok: false, error: "Something went wrong. Try again later." },
      { status: 500, ...noStore },
    );
  }
}
