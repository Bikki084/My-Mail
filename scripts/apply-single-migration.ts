/**
 * Apply one migration file using SUPABASE_ACCESS_TOKEN or SUPABASE_DB_URL.
 * Usage: npx tsx scripts/apply-single-migration.ts 20250610120000_user_outbound_ip_rotation_index.sql
 */
import { readFileSync, existsSync } from "node:fs";
import { resolve, join } from "node:path";
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

function projectRefFromUrl(url: string): string | null {
  const m = url.match(/^https?:\/\/([a-z0-9]+)\.supabase\.co/i);
  return m?.[1] ?? null;
}

async function applyViaToken(token: string, projectRef: string, sql: string): Promise<void> {
  const res = await fetch(
    `https://api.supabase.com/v1/projects/${projectRef}/database/query`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ query: sql }),
    },
  );
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`${res.status} ${res.statusText}: ${body}`);
  }
}

async function applyViaPg(connStr: string, sql: string): Promise<void> {
  const client = new Client({
    connectionString: connStr,
    ssl: { rejectUnauthorized: false },
  });
  await client.connect();
  try {
    await client.query(sql);
  } finally {
    await client.end();
  }
}

const fileName = process.argv[2] ?? "20250610120000_user_outbound_ip_rotation_index.sql";
loadEnvLocal();

const path = resolve(process.cwd(), "supabase", "migrations", fileName);
if (!existsSync(path)) {
  console.error(`Migration not found: ${path}`);
  process.exit(1);
}
const sql = readFileSync(path, "utf8");

const token = process.env.SUPABASE_ACCESS_TOKEN?.trim();
const dbUrl = process.env.SUPABASE_DB_URL?.trim();
const projectRef = projectRefFromUrl(process.env.NEXT_PUBLIC_SUPABASE_URL ?? "");

try {
  if (token && projectRef) {
    console.log(`Applying via Management API (project ${projectRef})…`);
    await applyViaToken(token, projectRef, sql);
  } else if (dbUrl) {
    console.log("Applying via direct Postgres…");
    await applyViaPg(dbUrl, sql);
  } else {
    console.error("Need SUPABASE_ACCESS_TOKEN or SUPABASE_DB_URL in .env.local");
    process.exit(1);
  }
  console.log("Migration applied successfully.");
} catch (e) {
  console.error("Migration failed:", e instanceof Error ? e.message : e);
  process.exit(1);
}
