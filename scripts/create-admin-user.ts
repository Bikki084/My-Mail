/**
 * Bootstrap the initial admin user in Supabase Auth.
 *
 * Preferred (reliable): set SUPABASE_SERVICE_ROLE_KEY in `.env.local` temporarily
 * (Dashboard → Settings → API → service_role secret). Run this script once, then remove
 * the service role key from the file. Never expose that key to the browser or commit it.
 *
 * The service role path uses auth.admin.createUser — it does NOT go through public sign-up
 * flags, confirmation mail rate limits, or disposable-email blocks the same way signUp does.
 *
 * Fallback (may fail depending on project settings): anon key only + auth.signUp().
 *
 * Usage:
 *   npm run create-admin
 *
 * Env (.env.local or shell):
 *   BOOTSTRAP_ADMIN_EMAIL   (default: mymail87455@gmail.com)
 *   BOOTSTRAP_ADMIN_PASSWORD (default: admin — retried as admin123 if too short)
 *   SUPABASE_SERVICE_ROLE_KEY (recommended for one-time provisioning)
 *
 * If the legacy bootstrap account `admin@gmail.com` exists on the project, the
 * service-role path renames it to BOOTSTRAP_ADMIN_EMAIL in place — the password
 * is preserved and the row keeps its `id`, so existing profile / credit data
 * carries over. The old address is never recreated.
 */

import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import { createClient } from "@supabase/supabase-js";

const LEGACY_ADMIN_EMAIL = "admin@gmail.com";

function loadEnvLocal(): void {
  const p = resolve(process.cwd(), ".env.local");
  if (!existsSync(p)) return;
  const raw = readFileSync(p, "utf8");
  for (const line of raw.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq <= 0) continue;
    const key = trimmed.slice(0, eq).trim();
    let val = trimmed.slice(eq + 1).trim();
    if (
      (val.startsWith('"') && val.endsWith('"')) ||
      (val.startsWith("'") && val.endsWith("'"))
    ) {
      val = val.slice(1, -1);
    }
    if (!process.env[key]) process.env[key] = val;
  }
}

async function provisionWithServiceRole(
  url: string,
  serviceKey: string,
  email: string,
  password: string,
): Promise<boolean> {
  const adminClient = createClient(url, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  console.log("[create-admin] Using service role → auth.admin.createUser …");

  // If the legacy `admin@gmail.com` user is still on the project, rename it to
  // the new bootstrap address in place (preserving id + password) and skip
  // creating a duplicate. Idempotent — does nothing if the legacy user is gone
  // or already points at the new email.
  if (email.toLowerCase() !== LEGACY_ADMIN_EMAIL) {
    const list = await adminClient.auth.admin.listUsers();
    const legacy = list.data?.users?.find(
      (u) => u.email?.toLowerCase() === LEGACY_ADMIN_EMAIL,
    );
    const target = list.data?.users?.find(
      (u) => u.email?.toLowerCase() === email.toLowerCase(),
    );
    if (legacy && !target) {
      console.log(
        `[create-admin] Found legacy ${LEGACY_ADMIN_EMAIL} (${legacy.id}). Renaming to ${email}…`,
      );
      const { error: renameErr } = await adminClient.auth.admin.updateUserById(
        legacy.id,
        {
          email,
          email_confirm: true,
          user_metadata: {
            ...(legacy.user_metadata ?? {}),
            role: "admin",
            full_name: "Admin",
          },
        },
      );
      if (renameErr) {
        console.error(
          "[create-admin] Could not rename legacy admin user:",
          renameErr.message,
        );
        return false;
      }
      const { error: profErr } = await adminClient
        .from("profiles")
        .update({ email, role: "admin", status: "active" })
        .eq("id", legacy.id);
      if (profErr) {
        console.warn(
          "[create-admin] Renamed auth user but profile update failed:",
          profErr.message,
        );
      }
      console.log(
        `\n→ Sign in at /login with:\n   Email:    ${email}\n   Password: (your existing password for the legacy admin account)\n`,
      );
      return true;
    }
  }

  const { data, error } = await adminClient.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: {
      role: "admin",
      full_name: "Admin",
    },
    app_metadata: {},
  });

  if (error) {
    const msg = error.message.toLowerCase();
    if (msg.includes("already") || msg.includes("registered")) {
      console.warn("[create-admin] User already exists. Ensuring admin role in metadata…");
      const list = await adminClient.auth.admin.listUsers();
      const existing = list.data?.users?.find(
        (u) => u.email?.toLowerCase() === email.toLowerCase(),
      );
      if (existing?.id) {
        const { error: updErr } = await adminClient.auth.admin.updateUserById(
          existing.id,
          {
            user_metadata: {
              ...(existing.user_metadata ?? {}),
              role: "admin",
              full_name: "Admin",
            },
          },
        );
        if (updErr) {
          console.error("[create-admin] Could not update user:", updErr.message);
          return false;
        }
        console.log("[create-admin] Updated existing user:", existing.id);
        console.log(
          `\n→ Sign in at /login with:\n   Email:    ${email}\n   Password: (your existing password for this account)\n`,
        );
        return true;
      }
      console.error("[create-admin]", error.message);
      return false;
    }
    console.error("[create-admin]", error.message);
    return false;
  }

  console.log("[create-admin] OK — user id:", data.user?.id);
  console.log(`\n→ Sign in at /login with:\n   Email:    ${email}\n   Password: ${password}\n`);
  return true;
}

async function provisionWithSignUp(
  url: string,
  anon: string,
  email: string,
  password: string,
): Promise<boolean> {
  const supabase = createClient(url, anon, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  console.log("[create-admin] Using anon key → auth.signUp …");

  let pwd = password;
  let { data, error } = await supabase.auth.signUp({
    email,
    password: pwd,
    options: {
      data: {
        role: "admin",
        full_name: "Admin",
      },
    },
  });

  if (error?.message.toLowerCase().includes("password") && pwd.length < 6) {
    console.warn(
      "[create-admin] Password rejected (often min 6 chars). Retrying with 'admin123'…",
    );
    pwd = "admin123";
    ({ data, error } = await supabase.auth.signUp({
      email,
      password: pwd,
      options: {
        data: {
          role: "admin",
          full_name: "Admin",
        },
      },
    }));
  }

  if (!error && data.user) {
    console.log("[create-admin] OK — user created:", data.user.id);
    console.log(
      data.session
        ? "Session returned (likely auto-confirmed)."
        : "No session — confirm the user in Dashboard → Authentication → Users, or disable email confirmation.",
    );
    console.log(`\n→ Sign in at /login with:\n   Email:    ${email}\n   Password: ${pwd}\n`);
    return true;
  }

  const msg = error?.message ?? "";
  if (msg.toLowerCase().includes("already") || msg.toLowerCase().includes("registered")) {
    console.warn("[create-admin] User already exists — testing password…");
    const signIn = await supabase.auth.signInWithPassword({ email, password: pwd });
    if (!signIn.error) {
      console.log("[create-admin] Password OK for existing user.");
      await supabase.auth.signOut();
      console.log(`\n→ Sign in at /login with:\n   Email:    ${email}\n   Password: ${pwd}\n`);
      return true;
    }
    console.error("[create-admin] User exists but password did not match:", signIn.error.message);
    return false;
  }

  console.error("[create-admin] signUp failed:", error?.message ?? error);
  if (error?.message?.includes("invalid") || error?.code === "email_address_invalid") {
    console.error(
      "\nTip: Some projects reject certain addresses or require SMTP. Easiest fix: add",
      "\nSUPABASE_SERVICE_ROLE_KEY to .env.local (temporarily) and run this script again.",
    );
  }
  if (
    msg.toLowerCase().includes("signup") ||
    msg.toLowerCase().includes("not allowed")
  ) {
    console.error(
      "\nEnable sign-ups: Dashboard → Authentication → Providers → Email → allow new users.",
    );
  }
  if (msg.toLowerCase().includes("rate")) {
    console.error("\nWait a few minutes (email rate limit), or use the service role method.");
  }
  return false;
}

async function main(): Promise<void> {
  loadEnvLocal();

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim();
  const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY?.trim();
  const serviceRole = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();

  const email =
    process.env.BOOTSTRAP_ADMIN_EMAIL?.trim() ?? "mymail87455@gmail.com";
  const password =
    process.env.BOOTSTRAP_ADMIN_PASSWORD?.trim() ?? "admin";

  if (!url || !anon) {
    console.error(
      "Missing NEXT_PUBLIC_SUPABASE_URL or NEXT_PUBLIC_SUPABASE_ANON_KEY (.env.local).",
    );
    process.exit(1);
  }

  console.log(`[create-admin] Email: ${email}`);

  const effectivePassword = password.length >= 6 ? password : "admin123";
  if (password.length < 6) {
    console.warn(
      `[create-admin] Password shorter than 6 chars — using "${effectivePassword}" (Supabase default minimum).`,
    );
  }

  let ok = false;
  if (serviceRole) {
    ok = await provisionWithServiceRole(url, serviceRole, email, effectivePassword);
  } else {
    ok = await provisionWithSignUp(url, anon, email, effectivePassword);
    if (!ok) {
      console.error(
        "\n---",
        "\nNo SUPABASE_SERVICE_ROLE_KEY found. To create the admin without relying on public sign-up:",
        "\n1. Dashboard → Settings → API → copy **service_role** secret",
        "\n2. Add one line to .env.local:  SUPABASE_SERVICE_ROLE_KEY=…",
        "\n3. Run: npm run create-admin",
        "\n4. Remove SUPABASE_SERVICE_ROLE_KEY from .env.local after success.",
        "\n---\n",
      );
    }
  }

  process.exit(ok ? 0 : 1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
