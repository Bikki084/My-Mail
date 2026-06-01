/**
 * Run on the server after editing .env.local:
 *   node scripts/verify-build-env.mjs
 *
 * Checks .env.local values and whether the last build embedded your Supabase URL.
 */
import { readFileSync, existsSync, readdirSync } from "node:fs";
import { join } from "node:path";

const root = process.cwd();
const envPath = join(root, ".env.local");

function parseEnvFile(path) {
  if (!existsSync(path)) return {};
  const env = {};
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
    env[m[1]] = v;
  }
  return env;
}

function authOk(url, key) {
  if (!url?.trim() || !key?.trim()) return { ok: false, reason: "missing" };
  if (url.includes("example.supabase.co") || url.includes("your-project"))
    return { ok: false, reason: "placeholder URL" };
  if (url.includes("/rest/v1")) return { ok: false, reason: "URL must not include /rest/v1" };
  if (key.includes("your-anon") || key.includes("placeholder"))
    return { ok: false, reason: "placeholder key" };
  if (key.length < 80) return { ok: false, reason: `anon key too short (${key.length} chars)` };
  if (!key.startsWith("eyJ")) return { ok: false, reason: "anon key should be a JWT (starts with eyJ)" };
  return { ok: true, reason: "ok" };
}

const env = parseEnvFile(envPath);
const url = env.NEXT_PUBLIC_SUPABASE_URL ?? "";
const key = env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "";
const check = authOk(url, key);

console.log("\n[verify-build-env] .env.local");
console.log("  file exists:", existsSync(envPath));
console.log("  URL length:", url.length, url ? `(${url.slice(0, 42)}…)` : "");
console.log("  anon key length:", key.length);
console.log("  auth check:", check.ok ? "PASS" : "FAIL — " + check.reason);

let foundInBuild = false;
const staticDir = join(root, ".next", "static");
if (existsSync(staticDir)) {
  const host = url.replace(/^https:\/\//, "").split("/")[0];
  if (host) {
    const walk = (dir) => {
      for (const name of readdirSync(dir, { withFileTypes: true })) {
        const p = join(dir, name.name);
        if (name.isDirectory()) walk(p);
        else if (name.name.endsWith(".js")) {
          try {
            if (readFileSync(p, "utf8").includes(host)) foundInBuild = true;
          } catch {
            /* ignore */
          }
        }
      }
    };
    walk(staticDir);
  }
}

console.log("\n[verify-build-env] last build (.next/static)");
console.log(
  "  Supabase host in client bundle:",
  foundInBuild ? "YES — rebuild looks good" : "NO — run: rm -rf .next && npm run build",
);
console.log("");

process.exit(check.ok && foundInBuild ? 0 : 1);
