/**
 * One-off: reset stale user_outbound_ip values to the Lightsail primary IP.
 *   npx tsx scripts/fix-outbound-ip.ts
 */
import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import { createClient } from "@supabase/supabase-js";

const POOL = ["13.203.176.51", "15.206.86.111"] as const;
const PRIMARY = "13.203.176.51";

function loadEnvLocal(): void {
  const p = resolve(process.cwd(), ".env.local");
  if (!existsSync(p)) return;
  for (const line of readFileSync(p, "utf8").split("\n")) {
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
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();
  if (!url || !key) {
    console.error("[fix-outbound-ip] Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY");
    process.exit(1);
  }

  const supabase = createClient(url, key);
  const { data: rows, error: selErr } = await supabase
    .from("user_outbound_ip")
    .select("user_id, current_ip");
  if (selErr) {
    console.error("[fix-outbound-ip] Select failed:", selErr.message);
    process.exit(1);
  }

  console.log("[fix-outbound-ip] Before:", rows);
  const toFix = (rows ?? []).filter(
    (r) => r.current_ip && !POOL.includes(r.current_ip as (typeof POOL)[number]),
  );

  if (toFix.length === 0) {
    console.log("[fix-outbound-ip] Nothing to update — all IPs already in pool.");
    return;
  }

  for (const row of toFix) {
    const { error } = await supabase
      .from("user_outbound_ip")
      .update({
        current_ip: PRIMARY,
        updated_at: new Date().toISOString(),
      })
      .eq("user_id", row.user_id);
    if (error) {
      console.error(`[fix-outbound-ip] Update failed for ${row.user_id}:`, error.message);
      process.exit(1);
    }
    console.log(`[fix-outbound-ip] Fixed ${row.user_id}: ${row.current_ip} -> ${PRIMARY}`);
  }

  const { data: after } = await supabase
    .from("user_outbound_ip")
    .select("user_id, current_ip");
  console.log("[fix-outbound-ip] After:", after);
}

main().catch((e) => {
  console.error("[fix-outbound-ip] Failed:", e instanceof Error ? e.message : e);
  process.exit(1);
});
