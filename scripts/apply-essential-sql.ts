/**
 * Applies supabase/essential-for-send.sql via direct Postgres (SUPABASE_DB_URL).
 * Use when PAT migrations return 401 or you only need send-related columns.
 *
 *   npm run db:essential
 */
import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import { Client } from "pg";

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
  const dbUrl = process.env.SUPABASE_DB_URL?.trim();
  if (!dbUrl) {
    console.error(
      "[db:essential] SUPABASE_DB_URL is not set in .env.local.\n" +
        "  1. Supabase Dashboard → Settings → Database → Connection string → URI\n" +
        "  2. Replace [YOUR-PASSWORD] with your database password\n" +
        "  3. Add: SUPABASE_DB_URL=postgresql://postgres:PASSWORD@db.xxx.supabase.co:5432/postgres\n" +
        "\nOr paste supabase/essential-for-send.sql in Supabase SQL Editor (no server env needed).",
    );
    process.exit(1);
  }

  const sqlPath = resolve(process.cwd(), "supabase", "essential-for-send.sql");
  const sql = readFileSync(sqlPath, "utf8");
  const client = new Client({ connectionString: dbUrl });
  console.log("[db:essential] Connecting to Postgres …");
  await client.connect();
  try {
    console.log("[db:essential] Applying essential-for-send.sql …");
    await client.query(sql);
    console.log("[db:essential] Done. Restart the app: pm2 restart all");
  } finally {
    await client.end();
  }
}

main().catch((e) => {
  console.error("[db:essential] Failed:", e instanceof Error ? e.message : e);
  process.exit(1);
});
