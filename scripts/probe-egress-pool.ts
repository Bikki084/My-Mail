/**
 * Verify real egress routes on the server (run on VPS after configuring .env.local).
 * Usage: npx tsx scripts/probe-egress-pool.ts
 */
import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";

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
  const { resolveEgressMode } = await import("../src/lib/egress-mode");
  const {
    resolveEgressProxyPool,
    resolveExitIpv4ForEgressUrl,
    verifyEgressProxyPool,
  } = await import("../src/lib/smtp-egress-proxy");

  console.log(`Egress mode: ${resolveEgressMode()}`);
  const pool = await resolveEgressProxyPool();
  console.log(`Routes configured: ${pool.length}`);
  if (pool.length === 0) {
    console.error(
      "No routes. Set OUTBOUND_IP_PROXY_POOL or OUTBOUND_IP_PROXY_AUTO_BIND=1 with AWS Lightsail IPs.",
    );
    process.exit(1);
  }
  for (const url of pool) {
    const exit = await resolveExitIpv4ForEgressUrl(url, true);
    console.log(`  ${url} → ${exit ?? "FAILED"}`);
  }
  const { ok } = await verifyEgressProxyPool();
  process.exit(ok ? 0 : 1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
