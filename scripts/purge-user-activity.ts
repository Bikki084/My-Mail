/**
 * Purge user activity rows whose expires_at is in the past.
 * Cascade deletes snapshots and recipients. Safe to run hourly via site-watchdog cron.
 *
 * Usage: npm run purge-user-activity
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
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    console.error("Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in .env.local");
    process.exit(1);
  }

  const supabase = createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const now = new Date().toISOString();
  const { data, error } = await supabase
    .from("user_activity_batches")
    .delete()
    .lt("expires_at", now)
    .select("campaign_id");

  if (error) {
    console.error(`[purge-user-activity] failed: ${error.message}`);
    process.exit(1);
  }

  const count = data?.length ?? 0;
  if (count > 0) {
    console.log(`[purge-user-activity] removed ${count} expired batch(es) (before ${now})`);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
