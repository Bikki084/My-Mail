/**
 * Shared migration runner used by:
 *
 *   - `npm run db:migrate` (scripts/apply-migrations.ts) — one-shot, fail loudly
 *     if anything errors so CI / human sees the problem.
 *   - `npm run dev` (scripts/run-dev.cjs) — best-effort on every startup so
 *     forgetting to run migrations after a `git pull` doesn't silently brick
 *     the send pipeline (the symptom the user kept hitting: green-tick toast,
 *     no email, "Campaign not found" in logs because runSendCampaign's SELECT
 *     referenced columns the DB hadn't added yet).
 *
 * Migrations are tracked in `_mymail_migrations` (filename + applied_at). Files
 * that already appear there are skipped, so this is safe to run on every dev
 * startup. The Supabase Management API is required (SUPABASE_ACCESS_TOKEN +
 * NEXT_PUBLIC_SUPABASE_URL) — direct Postgres mode is left to the standalone
 * `npm run db:migrate` script for users who chose Mode B.
 */
"use strict";

const fs = require("node:fs");
const path = require("node:path");

const TRACKING_TABLE_DDL = `
create table if not exists public._mymail_migrations (
  filename text primary key,
  applied_at timestamptz not null default now()
);
`;

function readEnvFile(p) {
  if (!fs.existsSync(p)) return {};
  const out = {};
  for (const line of fs.readFileSync(p, "utf8").split(/\r?\n/)) {
    const m = /^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/.exec(line);
    if (!m) continue;
    let v = m[2].trim();
    if (
      (v.startsWith('"') && v.endsWith('"')) ||
      (v.startsWith("'") && v.endsWith("'"))
    ) {
      v = v.slice(1, -1);
    }
    out[m[1]] = v;
  }
  return out;
}

/** Combine .env.local / .env values with process.env (process.env wins). */
function loadEnv(cwd) {
  const local = readEnvFile(path.join(cwd, ".env.local"));
  const dotenv = readEnvFile(path.join(cwd, ".env"));
  const merged = { ...dotenv, ...local };
  for (const [k, v] of Object.entries(merged)) {
    if (process.env[k] == null) process.env[k] = v;
  }
}

function projectRefFromUrl(url) {
  if (!url) return null;
  const m = String(url).match(/^https?:\/\/([a-z0-9]+)\.supabase\.co/i);
  return m && m[1] ? m[1] : null;
}

function listMigrationFiles(cwd) {
  const dir = path.join(cwd, "supabase", "migrations");
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir)
    .filter((f) => f.endsWith(".sql"))
    .sort()
    .map((f) => ({ name: f, abs: path.join(dir, f) }));
}

async function mgmtQuery(token, projectRef, sql) {
  const endpoint = `https://api.supabase.com/v1/projects/${projectRef}/database/query`;
  const res = await fetch(endpoint, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ query: sql }),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    const err = new Error(
      `Supabase Management API ${res.status} ${res.statusText}: ${body.slice(0, 500)}`,
    );
    err.status = res.status;
    err.body = body;
    throw err;
  }
  // Response is a JSON array of rows; we only need it for `select` queries.
  return res.json().catch(() => null);
}

/**
 * Apply any migrations that are not yet recorded in `_mymail_migrations`.
 * Returns:
 *   { ok: true, applied: string[], skipped: string[] }
 *   { ok: false, reason: string, error?: Error, applied: string[], remaining: string[] }
 *   { ok: true, mode: "skipped", reason: string } // when prerequisites missing
 */
async function applyPendingMigrations({
  cwd,
  log = (s) => process.stdout.write(s),
} = {}) {
  if (!cwd) cwd = process.cwd();
  loadEnv(cwd);

  const token = (process.env.SUPABASE_ACCESS_TOKEN || "").trim();
  const url = (process.env.NEXT_PUBLIC_SUPABASE_URL || "").trim();
  const ref = projectRefFromUrl(url);
  if (!token || !ref) {
    return {
      ok: true,
      mode: "skipped",
      reason:
        "Auto-migrate disabled: SUPABASE_ACCESS_TOKEN and/or NEXT_PUBLIC_SUPABASE_URL not set in .env.local. " +
        "Run `npm run db:migrate` manually if you've pulled new migrations.",
    };
  }

  const files = listMigrationFiles(cwd);
  if (files.length === 0) {
    return { ok: true, applied: [], skipped: [] };
  }

  // Bootstrap the tracking table. If this fails (e.g. token has no DDL perms
  // or network is down) we surface it but don't crash dev startup.
  try {
    await mgmtQuery(token, ref, TRACKING_TABLE_DDL);
  } catch (err) {
    return {
      ok: false,
      reason:
        "Could not create _mymail_migrations tracking table — auto-migrate skipped. " +
        "Run `npm run db:migrate` manually if columns appear missing at runtime.",
      error: err,
      applied: [],
      remaining: files.map((f) => f.name),
    };
  }

  let applied = [];
  let appliedSet = new Set();
  try {
    const rows = await mgmtQuery(
      token,
      ref,
      "select filename from public._mymail_migrations",
    );
    if (Array.isArray(rows)) {
      for (const r of rows) {
        const fn = r && typeof r.filename === "string" ? r.filename : null;
        if (fn) appliedSet.add(fn);
      }
    }
  } catch (err) {
    return {
      ok: false,
      reason:
        "Could not read _mymail_migrations — auto-migrate skipped. Run `npm run db:migrate` manually.",
      error: err,
      applied: [],
      remaining: files.map((f) => f.name),
    };
  }

  const pending = files.filter((f) => !appliedSet.has(f.name));
  if (pending.length === 0) {
    return { ok: true, applied: [], skipped: files.map((f) => f.name) };
  }

  log(
    `[db:migrate] Applying ${pending.length} pending migration(s) from supabase/migrations/:\n`,
  );
  for (const file of pending) {
    log(`[db:migrate]   ${file.name} … `);
    const sql = fs.readFileSync(file.abs, "utf8");
    try {
      await mgmtQuery(token, ref, sql);
      // Record success — quote single quotes in the filename defensively
      // even though our migration files only contain ASCII.
      const safeName = file.name.replace(/'/g, "''");
      await mgmtQuery(
        token,
        ref,
        `insert into public._mymail_migrations (filename) values ('${safeName}') on conflict (filename) do nothing`,
      );
      applied.push(file.name);
      log("ok\n");
    } catch (err) {
      log("FAILED\n");
      const msg = err && err.message ? err.message : String(err);
      log(`[db:migrate]     ${msg}\n`);
      // Mark as remaining so caller can surface the rest.
      const remainingNames = pending.slice(pending.indexOf(file)).map((f) => f.name);
      return {
        ok: false,
        reason: `Migration ${file.name} failed. Fix the SQL or apply manually with \`npm run db:migrate -- --only=${file.name}\``,
        error: err,
        applied,
        remaining: remainingNames,
      };
    }
  }
  log(`[db:migrate] Done. Applied ${applied.length} migration(s).\n`);
  return { ok: true, applied, skipped: [...appliedSet] };
}

/**
 * Mark every existing migration file as already-applied without running its
 * SQL. Used the first time the tracking table is bootstrapped on a project
 * that was set up before tracking existed — those files have already been
 * applied via `npm run db:migrate` in the past, so re-running them would just
 * waste a round-trip (and in some cases trip "policy already exists" errors).
 *
 * Not currently called from the auto-runner (we let migrations re-execute
 * since they're written to be idempotent). Exposed for future tooling.
 */
async function markAllApplied({ cwd } = {}) {
  if (!cwd) cwd = process.cwd();
  loadEnv(cwd);
  const token = (process.env.SUPABASE_ACCESS_TOKEN || "").trim();
  const ref = projectRefFromUrl(process.env.NEXT_PUBLIC_SUPABASE_URL);
  if (!token || !ref) throw new Error("SUPABASE_ACCESS_TOKEN / URL not set");
  await mgmtQuery(token, ref, TRACKING_TABLE_DDL);
  const files = listMigrationFiles(cwd);
  for (const f of files) {
    const safe = f.name.replace(/'/g, "''");
    await mgmtQuery(
      token,
      ref,
      `insert into public._mymail_migrations (filename) values ('${safe}') on conflict (filename) do nothing`,
    );
  }
}

module.exports = {
  applyPendingMigrations,
  listMigrationFiles,
  loadEnv,
  markAllApplied,
};
