/**
 * Verify (and if necessary backfill) the bootstrap admin's profile row.
 *
 * Run with the same SUPABASE_SERVICE_ROLE_KEY you used for create-admin.
 * Idempotent — safe to run multiple times.
 *
 * Usage:
 *   npm run verify-admin
 */

import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import { createClient } from "@supabase/supabase-js";

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

async function main(): Promise<void> {
  loadEnvLocal();

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim();
  const serviceRole = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();
  const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY?.trim();
  const email = process.env.BOOTSTRAP_ADMIN_EMAIL?.trim() ?? "mymail87455@gmail.com";
  const password = process.env.BOOTSTRAP_ADMIN_PASSWORD?.trim();

  if (!password || password.length < 6) {
    console.error(
      "Set BOOTSTRAP_ADMIN_PASSWORD in .env.local (min 6 characters). Do not rely on repo defaults.",
    );
    process.exit(1);
  }

  if (!url || !serviceRole || !anon) {
    console.error(
      "Missing NEXT_PUBLIC_SUPABASE_URL / NEXT_PUBLIC_SUPABASE_ANON_KEY / SUPABASE_SERVICE_ROLE_KEY.",
    );
    process.exit(1);
  }

  const admin = createClient(url, serviceRole, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  // 1. Find auth user
  const list = await admin.auth.admin.listUsers();
  const authUser = list.data?.users?.find(
    (u) => u.email?.toLowerCase() === email.toLowerCase(),
  );
  if (!authUser) {
    console.error(`[verify-admin] No auth user for ${email}. Run create-admin first.`);
    process.exit(1);
  }
  console.log("[verify-admin] auth user id:", authUser.id);

  // 2. Inspect profile row
  const { data: profile, error: profErr } = await admin
    .from("profiles")
    .select("id, email, role, status, full_name")
    .eq("id", authUser.id)
    .maybeSingle();

  if (profErr) {
    console.error("[verify-admin] Could not query profiles:", profErr.message);
    process.exit(1);
  }

  if (!profile) {
    console.warn("[verify-admin] No profile row — inserting (handle_new_user trigger likely missing).");
    const { error: insErr } = await admin.from("profiles").insert({
      id: authUser.id,
      email: authUser.email ?? email,
      full_name: "Admin",
      role: "admin",
      status: "active",
    });
    if (insErr) {
      console.error("[verify-admin] Insert failed:", insErr.message);
      process.exit(1);
    }
    await admin
      .from("credits")
      .upsert({ user_id: authUser.id }, { onConflict: "user_id" });
    console.log("[verify-admin] Profile inserted with role=admin.");
  } else {
    console.log("[verify-admin] Existing profile:", profile);
    if (profile.role !== "admin" || profile.status !== "active") {
      const { error: updErr } = await admin
        .from("profiles")
        .update({ role: "admin", status: "active" })
        .eq("id", authUser.id);
      if (updErr) {
        console.error("[verify-admin] Update failed:", updErr.message);
        process.exit(1);
      }
      console.log("[verify-admin] Promoted profile to role=admin / status=active.");
    } else {
      console.log("[verify-admin] Profile already admin/active. ✔");
    }
  }

  // 3. Smoke-test sign-in via the anon client (mirrors what the SignInForm does)
  const anonClient = createClient(url, anon, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const signIn = await anonClient.auth.signInWithPassword({ email, password });
  if (signIn.error) {
    console.error("[verify-admin] anon signIn failed:", signIn.error.message);
    process.exit(1);
  }
  console.log("[verify-admin] anon signIn OK — user id:", signIn.data.user?.id);

  const { data: roleProbe, error: probeErr } = await anonClient
    .from("profiles")
    .select("role")
    .eq("id", signIn.data.user!.id)
    .maybeSingle();
  if (probeErr) {
    console.error(
      "[verify-admin] anon role lookup failed (likely RLS recursion). Apply",
      "supabase/migrations/20260420120000_fix_profiles_rls_recursion.sql in the SQL editor.",
      "\nDetails:",
      probeErr.message,
    );
    await anonClient.auth.signOut();
    process.exit(1);
  }
  console.log("[verify-admin] anon role lookup result:", roleProbe);
  await anonClient.auth.signOut();

  console.log(
    `\n✅ Ready. Sign in at /login with:\n   Email:    ${email}\n   Password: ${password}\n`,
  );
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
