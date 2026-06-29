/**
 * Verify real egress routes on the server (run on VPS after configuring .env.local).
 * Usage: npx tsx scripts/probe-egress-pool.ts
 */
import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import {
  probeEgressRoute,
  resolveEgressModeFromEnv,
  resolveEgressRoutesFromEnv,
} from "./lib/egress-probe";

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

async function main() {
  loadEnvLocal();
  console.log(`Egress mode: ${resolveEgressModeFromEnv()}`);
  const pool = resolveEgressRoutesFromEnv();
  console.log(`Routes configured: ${pool.length}`);
  if (pool.length === 0) {
    console.error(
      "No routes found. Set OUTBOUND_IP_PROXY_POOL or OUTBOUND_IP_PROXY_AUTO_BIND=1 with OUTBOUND_IP_POOL (real AWS IPs).",
    );
    process.exit(1);
  }
  let ok = false;
  for (const url of pool) {
    const exit = await probeEgressRoute(url);
    console.log(`  ${url} → ${exit ?? "FAILED"}`);
    if (exit) ok = true;
  }
  process.exit(ok ? 0 : 1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
