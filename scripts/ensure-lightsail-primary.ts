/**
 * Re-attach the primary Lightsail static IP (website URL) after a legacy full-swap rotate.
 *   npx tsx scripts/ensure-lightsail-primary.ts
 */
import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import {
  ensureLightsailPrimaryStaticIpAttached,
  fetchLightsailAttachedStaticIpv4,
  getLightsailPrimaryStaticIpName,
  isAwsLightsailRotationConfigured,
} from "@/lib/aws-outbound-ip";

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
  if (!isAwsLightsailRotationConfigured()) {
    console.error(
      "[ensure-primary] Set AWS_LIGHTSAIL_STATIC_IP_NAMES (2+) and AWS_LIGHTSAIL_INSTANCE_NAME in .env.local",
    );
    process.exit(1);
  }
  const primary = getLightsailPrimaryStaticIpName();
  const before = await fetchLightsailAttachedStaticIpv4();
  console.log(`[ensure-primary] Before: attached=${before ?? "none"}, target primary=${primary}`);
  await ensureLightsailPrimaryStaticIpAttached();
  const after = await fetchLightsailAttachedStaticIpv4();
  console.log(`[ensure-primary] After: attached=${after ?? "none"}`);
}

main().catch((e) => {
  console.error("[ensure-primary] Failed:", e instanceof Error ? e.message : e);
  process.exit(1);
});
