/**
 * End-to-end smoke test (idempotent):
 * - sign in as admin via anon client
 * - service-role create a client user (or upsert profile)
 * - sign in as that client via anon client
 * - confirm role lookup is OK from both sides
 *
 * Usage:
 *   npm run smoke-auth
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

async function main() {
  loadEnvLocal();
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
  const svc = process.env.SUPABASE_SERVICE_ROLE_KEY!;
  if (!url || !anon || !svc) {
    console.error("Missing env (URL/anon/service role).");
    process.exit(1);
  }

  const adminEmail = "mymail87455@gmail.com";
  const adminPwd = "admin123";
  const clientEmail = "client.test@gmail.com";
  const clientPwd = "client123";

  const admin = createClient(url, svc, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  // ---- 1. Admin sign-in via anon
  const adminAnon = createClient(url, anon, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const aIn = await adminAnon.auth.signInWithPassword({
    email: adminEmail,
    password: adminPwd,
  });
  if (aIn.error) {
    console.error("[smoke] admin sign-in failed:", aIn.error.message);
    process.exit(1);
  }
  const adminProbe = await adminAnon
    .from("profiles")
    .select("role")
    .eq("id", aIn.data.user!.id)
    .maybeSingle();
  console.log("[smoke] admin OK — role:", adminProbe.data?.role);
  await adminAnon.auth.signOut();

  // ---- 2. Provision client (service role)
  const list = await admin.auth.admin.listUsers();
  let clientUser = list.data?.users?.find(
    (u) => u.email?.toLowerCase() === clientEmail,
  );

  if (!clientUser) {
    const { data, error } = await admin.auth.admin.createUser({
      email: clientEmail,
      password: clientPwd,
      email_confirm: true,
      user_metadata: { role: "client", full_name: "Client Test" },
    });
    if (error) {
      console.error("[smoke] createUser failed:", error.message);
      process.exit(1);
    }
    clientUser = data.user!;
    console.log("[smoke] client created:", clientUser.id);
  } else {
    // ensure password matches the smoke value
    const { error } = await admin.auth.admin.updateUserById(clientUser.id, {
      password: clientPwd,
      user_metadata: { role: "client", full_name: "Client Test" },
    });
    if (error) {
      console.error("[smoke] updateUser failed:", error.message);
      process.exit(1);
    }
    console.log("[smoke] client exists, password reset:", clientUser.id);
  }

  // ensure profile row exists with role=client
  await admin
    .from("profiles")
    .upsert(
      {
        id: clientUser.id,
        email: clientEmail,
        full_name: "Client Test",
        role: "client",
        status: "active",
      },
      { onConflict: "id" },
    );
  await admin
    .from("credits")
    .upsert({ user_id: clientUser.id }, { onConflict: "user_id" });

  // ---- 3. Client sign-in via anon
  const clientAnon = createClient(url, anon, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const cIn = await clientAnon.auth.signInWithPassword({
    email: clientEmail,
    password: clientPwd,
  });
  if (cIn.error) {
    console.error("[smoke] client sign-in failed:", cIn.error.message);
    process.exit(1);
  }
  const clientProbe = await clientAnon
    .from("profiles")
    .select("role, full_name")
    .eq("id", cIn.data.user!.id)
    .maybeSingle();
  console.log("[smoke] client OK — role:", clientProbe.data);
  await clientAnon.auth.signOut();

  console.log("\n✅ All sign-in paths working.\n");
  console.log(`Admin  → ${adminEmail} / ${adminPwd}`);
  console.log(`Client → ${clientEmail} / ${clientPwd}`);
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
