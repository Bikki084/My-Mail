import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { createServiceClient } from "@/lib/supabase/admin";
import { getBootstrapAdminEmail } from "@/lib/admin-bootstrap";
import {
  adminResetTokenExpiresAt,
  generateAdminResetSecret,
  hashAdminResetToken,
} from "@/lib/admin-reset-token";
import { sendAdminPasswordResetEmail } from "@/lib/admin-reset-mail";
import { sendAdminRecoveryViaSupabaseAuth } from "@/lib/admin-recovery-supabase";
import { getPublicOrigin } from "@/lib/request-origin";

const bodySchema = z.object({
  email: z.string().min(1).max(320),
});

const SUCCESS_MESSAGE =
  "If this email exists in our system, a reset link has been sent.";

/** Shown when the submitted address is not the configured admin login email. */
const NOT_ADMIN_EMAIL_ERROR =
  "Only the admin dashboard sign-in email is accepted. Enter the same address you use to log in.";

function isDevelopment(): boolean {
  return process.env.NODE_ENV === "development";
}

function uniformDelayMs(): number {
  return 350 + Math.floor(Math.random() * 250);
}

export async function POST(request: NextRequest) {
  await new Promise((r) => setTimeout(r, uniformDelayMs()));

  let json: unknown;
  try {
    json = await request.json();
  } catch {
    return NextResponse.json({ ok: true, message: SUCCESS_MESSAGE }, {
      headers: { "Cache-Control": "no-store" },
    });
  }

  const parsed = bodySchema.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json({ ok: true, message: SUCCESS_MESSAGE }, {
      headers: { "Cache-Control": "no-store" },
    });
  }

  const entered = parsed.data.email.trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(entered)) {
    return NextResponse.json({ ok: true, message: SUCCESS_MESSAGE }, {
      headers: { "Cache-Control": "no-store" },
    });
  }

  const adminEmail = getBootstrapAdminEmail().trim().toLowerCase();
  if (entered !== adminEmail) {
    return NextResponse.json(
      { ok: false, error: NOT_ADMIN_EMAIL_ERROR },
      {
        status: 422,
        headers: { "Cache-Control": "no-store" },
      },
    );
  }

  let devResetLink: string | undefined;

  try {
    const supabase = createServiceClient();

    const { data: adminProfile, error: profErr } = await supabase
      .from("profiles")
      .select("id, email, role")
      .eq("role", "admin")
      .maybeSingle();

    if (profErr || !adminProfile?.id) {
      console.error("[admin-forgot-password] admin profile:", profErr?.message);
      return NextResponse.json(
        { ok: true, message: SUCCESS_MESSAGE },
        { headers: { "Cache-Control": "no-store" } },
      );
    }

    if (adminProfile.email.trim().toLowerCase() !== adminEmail) {
      console.error(
        "[admin-forgot-password] profiles.email does not match bootstrap admin email — set BOOTSTRAP_ADMIN_EMAIL or fix profiles.email in the database.",
      );
      return NextResponse.json(
        { ok: true, message: SUCCESS_MESSAGE },
        { headers: { "Cache-Control": "no-store" } },
      );
    }

    const secret = generateAdminResetSecret();
    const tokenHash = hashAdminResetToken(secret);
    const expiresIso = adminResetTokenExpiresAt();

    const { error: updErr } = await supabase
      .from("profiles")
      .update({
        reset_token: tokenHash,
        reset_token_expiry: expiresIso,
      })
      .eq("id", adminProfile.id);

    if (updErr) {
      console.error(
        "[admin-forgot-password] could not store token — apply migration 20260506180000_admin_password_reset_columns.sql:",
        updErr.message,
      );
      return NextResponse.json(
        { ok: true, message: SUCCESS_MESSAGE },
        { headers: { "Cache-Control": "no-store" } },
      );
    }

    const origin = getPublicOrigin(request);
    const resetUrl = `${origin}/reset-password?token=${encodeURIComponent(secret)}`;

    try {
      await sendAdminPasswordResetEmail({
        to: getBootstrapAdminEmail().trim(),
        resetUrl,
      });
      console.info(
        `[admin-forgot-password] Reset email sent to ${getBootstrapAdminEmail().trim()} (app SMTP)`,
      );
    } catch (mailErr) {
      console.warn(
        "[admin-forgot-password] App SMTP failed (check ADMIN_RESET_SMTP_PASS or use a new Gmail App Password):",
        mailErr,
      );

      const supabaseRedirectTo = `${origin}/auth/update-password`;
      const viaSupabase = await sendAdminRecoveryViaSupabaseAuth(
        getBootstrapAdminEmail().trim(),
        supabaseRedirectTo,
      );

      if (viaSupabase.ok) {
        console.info(
          `[admin-forgot-password] Recovery email sent via Supabase Auth to ${getBootstrapAdminEmail().trim()}. ` +
            `Ensure "${supabaseRedirectTo}" is listed under Authentication → URL Configuration → Redirect URLs.`,
        );
      } else {
        console.error(
          "[admin-forgot-password] Supabase recovery email failed:",
          viaSupabase.message,
        );
        if (isDevelopment()) {
          devResetLink = resetUrl;
          console.warn(`[admin-forgot-password] DEV fallback — open this link once: ${resetUrl}`);
        }
      }
    }
  } catch (e) {
    console.error(
      "[admin-forgot-password] Unexpected error (check SUPABASE_SERVICE_ROLE_KEY in .env.local):",
      e,
    );
  }

  return NextResponse.json(
    {
      ok: true,
      message: SUCCESS_MESSAGE,
      ...(devResetLink ? { devResetLink } : {}),
    },
    { headers: { "Cache-Control": "no-store" } },
  );
}
