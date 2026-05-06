/**
 * Applies every SQL file in `supabase/migrations/` to your Supabase database
 * in lexicographic order. Idempotent — each migration uses
 * `create ... if not exists` / `add column if not exists` / `drop policy if exists`.
 *
 * Two supported authentication modes (auto-detected):
 *
 * --- Mode A: Personal Access Token (preferred — no DB password needed) ---
 *   1. Open https://supabase.com/dashboard/account/tokens
 *   2. Click "Generate new token", give it a name like "local migrations".
 *   3. Copy the token value (shown once).
 *   4. Add to `.env.local`:
 *        SUPABASE_ACCESS_TOKEN=sbp_...
 *   The script will derive the project ref from NEXT_PUBLIC_SUPABASE_URL and use
 *   the Supabase Management API endpoint /v1/projects/{ref}/database/query.
 *
 * --- Mode B: Direct Postgres connection ---
 *   1. Dashboard → Settings → Database → "Connection string" → URI tab.
 *   2. Copy the string, replace [YOUR-PASSWORD] with your DB password.
 *   3. Add to `.env.local`:
 *        SUPABASE_DB_URL=postgresql://postgres:YOURPASSWORD@db.xxx.supabase.co:5432/postgres
 *
 * Usage:
 *   npm run db:migrate
 *   npm run db:migrate -- --only=20260428120000_wallet_and_plans.sql
 *
 * When your Supabase project was created from `supabase/bootstrap.sql` or an
 * older init migration, running every file in order may fail (e.g. init tries
 * to `create policy` that already exists). In that case apply new migrations
 * only with `--only=<filename>`.
 */

import { readFileSync, existsSync, readdirSync } from "node:fs";
import { resolve, join } from "node:path";
import { Client } from "pg";

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

function listMigrationFiles(onlyName: string | null): { path: string; name: string }[] {
  const dir = resolve(process.cwd(), "supabase", "migrations");
  if (!existsSync(dir)) {
    console.error(`[db:migrate] No supabase/migrations directory at ${dir}`);
    process.exit(1);
  }
  const all = readdirSync(dir)
    .filter((f) => f.endsWith(".sql"))
    .sort()
    .map((f) => ({ path: join(dir, f), name: f }));

  if (!onlyName) return all;

  const wanted = onlyName.trim().toLowerCase();
  const matched = all.filter(
    (f) => f.name.toLowerCase() === wanted || f.name.toLowerCase().startsWith(wanted),
  );
  if (matched.length === 0) {
    console.error(
      `[db:migrate] --only=${onlyName} matched no files. Available: ${all.map((x) => x.name).join(", ")}`,
    );
    process.exit(1);
  }
  if (matched.length > 1 && !wanted.endsWith(".sql")) {
    console.error(
      `[db:migrate] --only=${onlyName} is ambiguous. Use the full file name, e.g. 20260428120000_wallet_and_plans.sql`,
    );
    process.exit(1);
  }
  return matched;
}

function parseOnlyArg(): string | null {
  for (const arg of process.argv.slice(2)) {
    if (arg.startsWith("--only=")) return arg.slice("--only=".length);
  }
  return null;
}

function projectRefFromUrl(url: string | undefined): string | null {
  if (!url) return null;
  const m = url.match(/^https?:\/\/([a-z0-9]+)\.supabase\.co/i);
  return m?.[1] ?? null;
}

function redactPassword(connStr: string): string {
  return connStr.replace(/:([^:@/]+)@/, ":****@");
}

async function applyViaAccessToken(
  token: string,
  projectRef: string,
  files: { path: string; name: string }[],
): Promise<void> {
  const endpoint = `https://api.supabase.com/v1/projects/${projectRef}/database/query`;
  console.log(
    `[db:migrate] Using Supabase Management API (project: ${projectRef}).`,
  );

  for (const file of files) {
    const sql = readFileSync(file.path, "utf8");
    process.stdout.write(`[db:migrate] Applying ${file.name} … `);

    let res: Response;
    try {
      res = await fetch(endpoint, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ query: sql }),
      });
    } catch (err) {
      console.log("FAILED");
      console.error(
        `\n[db:migrate] Network error contacting Supabase:`,
        (err as Error).message,
      );
      process.exit(1);
    }

    if (!res.ok) {
      console.log("FAILED");
      const body = await res.text().catch(() => "");
      console.error(
        `\n[db:migrate] ${file.name} failed (${res.status} ${res.statusText}):\n${body}`,
      );
      process.exit(1);
    }
    console.log("ok");
  }

  console.log(`\n[db:migrate] Done. Applied ${files.length} migration file(s).`);
}

async function applyViaPostgres(
  connStr: string,
  files: { path: string; name: string }[],
): Promise<void> {
  // Supabase requires SSL; node-postgres needs `rejectUnauthorized: false`
  // to accept the project's certificate without a custom CA bundle.
  const client = new Client({
    connectionString: connStr,
    ssl: { rejectUnauthorized: false },
  });

  console.log(`[db:migrate] Connecting to ${redactPassword(connStr)} …`);
  await client.connect();
  console.log("[db:migrate] Connected.");

  for (const file of files) {
    const sql = readFileSync(file.path, "utf8");
    process.stdout.write(`[db:migrate] Applying ${file.name} … `);
    try {
      await client.query("begin");
      await client.query(sql);
      await client.query("commit");
      console.log("ok");
    } catch (err) {
      await client.query("rollback").catch(() => {});
      console.log("FAILED");
      console.error(`\n[db:migrate] ${file.name} failed:`, (err as Error).message);
      await client.end();
      process.exit(1);
    }
  }

  await client.end();
  console.log(`\n[db:migrate] Done. Applied ${files.length} migration file(s).`);
}

async function main(): Promise<void> {
  loadEnvLocal();

  const only = parseOnlyArg();
  if (only) {
    console.log(`[db:migrate] Filter: --only=${only}\n`);
  }

  const files = listMigrationFiles(only);
  if (files.length === 0) {
    console.log("[db:migrate] No migration files found. Nothing to do.");
    return;
  }

  const token = process.env.SUPABASE_ACCESS_TOKEN?.trim();
  const dbUrl = process.env.SUPABASE_DB_URL?.trim();
  const projectRef = projectRefFromUrl(process.env.NEXT_PUBLIC_SUPABASE_URL);

  if (token && projectRef) {
    await applyViaAccessToken(token, projectRef, files);
    return;
  }

  if (dbUrl) {
    await applyViaPostgres(dbUrl, files);
    return;
  }

  console.error(
    "\n[db:migrate] No credentials found in .env.local.",
    "\n",
    "\nPick ONE of these (Mode A is easier — no DB password needed):",
    "\n",
    "\nMode A — Personal Access Token (recommended):",
    "\n  1. Visit https://supabase.com/dashboard/account/tokens",
    "\n  2. Click 'Generate new token'.",
    "\n  3. Add to .env.local:   SUPABASE_ACCESS_TOKEN=sbp_...",
    "\n",
    "\nMode B — Direct Postgres URL:",
    "\n  1. Dashboard → Settings → Database → Connection string → URI tab.",
    "\n  2. Copy and replace [YOUR-PASSWORD] with the DB password.",
    "\n  3. Add to .env.local:   SUPABASE_DB_URL=postgresql://postgres:PWD@db.xxx.supabase.co:5432/postgres",
    "\n",
  );
  process.exit(1);
}

main().catch((e) => {
  console.error("[db:migrate] Unexpected error:", e);
  process.exit(1);
});
