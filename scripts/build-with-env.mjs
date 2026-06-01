/**
 * Production build that loads .env.local (and .env.production.local if present)
 * before running `next build`, so NEXT_PUBLIC_* are embedded in the client bundle.
 *
 * Usage: node scripts/build-with-env.mjs
 */
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { spawnSync } from "node:child_process";

const root = process.cwd();

function loadFile(name) {
  const path = join(root, name);
  if (!existsSync(path)) return;
  for (const line of readFileSync(path, "utf8").split(/\r?\n/)) {
    const m = /^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/.exec(line);
    if (!m) continue;
    let v = m[2].trim();
    if (
      (v.startsWith('"') && v.endsWith('"')) ||
      (v.startsWith("'") && v.endsWith("'"))
    ) {
      v = v.slice(1, -1);
    }
    if (process.env[m[1]] == null) process.env[m[1]] = v;
  }
}

for (const name of [".env", ".env.local", ".env.production", ".env.production.local"]) {
  loadFile(name);
}

const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "";
if (!url.trim() || !key.trim() || key.length < 80) {
  console.error(
    "[build-with-env] NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY must be set in .env.local before building.",
  );
  console.error("  URL length:", url.length, "| anon key length:", key.length);
  process.exit(1);
}

console.log("[build-with-env] Building with Supabase URL:", url.slice(0, 40) + "…");

const r = spawnSync("npm", ["run", "build"], {
  stdio: "inherit",
  env: process.env,
  cwd: root,
  shell: true,
});

process.exit(r.status ?? 1);
