/**
 * Production build: load .env.local, enable low-memory mode on small VPS, then `next build`.
 *
 * Usage on Lightsail (512MB–2GB RAM):
 *   npm run build:prod
 *
 * Forces low-memory mode:
 *   LOW_MEMORY_BUILD=1 npm run build:prod
 */
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import os from "node:os";

const root = process.cwd();
const totalMemMb = Math.floor(os.totalmem() / (1024 * 1024));

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

const lowMemory =
  process.env.LOW_MEMORY_BUILD === "1" ||
  process.env.VPS_BUILD === "1" ||
  totalMemMb <= 2048;

if (lowMemory) {
  process.env.SKIP_NEXT_TYPECHECK = "1";
  process.env.SKIP_NEXT_LINT = "1";
  console.log(
    `[build-with-env] Low-memory VPS mode (${totalMemMb} MB RAM): skipping typecheck + lint during build.`,
  );
  console.log(
    "[build-with-env] Tip: run `bash scripts/ensure-swap.sh` once if build still OOMs.",
  );
}

const heapMb = (() => {
  const fromEnv = parseInt(process.env.NODE_BUILD_HEAP_MB ?? "", 10);
  if (Number.isFinite(fromEnv) && fromEnv > 256) return fromEnv;
  if (totalMemMb <= 1024) return 768;
  if (totalMemMb <= 2048) return 1024;
  return 1536;
})();

const buildEnv = {
  ...process.env,
  NODE_OPTIONS: `--max-old-space-size=${heapMb}`,
};

console.log(`[build-with-env] distDir=${process.env.NEXT_DIST_DIR || ".next"}`);
console.log("[build-with-env] Building with Supabase URL:", url.slice(0, 40) + "…");
console.log(`[build-with-env] NODE_OPTIONS=${buildEnv.NODE_OPTIONS}`);

const r = spawnSync("npx", ["next", "build"], {
  stdio: "inherit",
  env: buildEnv,
  cwd: root,
  shell: process.platform === "win32",
});

process.exit(r.status ?? 1);
