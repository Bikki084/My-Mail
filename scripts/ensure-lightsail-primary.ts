/**
 * Re-attach the primary Lightsail static IP (website URL) after a legacy full-swap rotate.
 * Standalone script — does not import src/lib (avoids Next.js server-only guard).
 *
 *   npm run lightsail:ensure-primary
 */
import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import {
  AttachStaticIpCommand,
  DetachStaticIpCommand,
  GetStaticIpsCommand,
  LightsailClient,
} from "@aws-sdk/client-lightsail";

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

function parseCsvEnv(name: string): string[] {
  const raw = process.env[name]?.trim();
  if (!raw) return [];
  return raw
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

function awsRegion(): string {
  return (
    process.env.AWS_LIGHTSAIL_REGION?.trim() ||
    process.env.AWS_REGION?.trim() ||
    process.env.AWS_DEFAULT_REGION?.trim() ||
    "us-east-1"
  );
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

async function fetchAttachedIpv4(
  client: LightsailClient,
  instanceName: string,
): Promise<string | null> {
  const listing = await client.send(new GetStaticIpsCommand({}));
  const attached = listing.staticIps?.find((s) => s.attachedTo === instanceName);
  return attached?.ipAddress?.trim() ?? null;
}

async function attachPrimary(): Promise<void> {
  const pool = parseCsvEnv("AWS_LIGHTSAIL_STATIC_IP_NAMES");
  const instanceName = process.env.AWS_LIGHTSAIL_INSTANCE_NAME?.trim();
  if (pool.length < 2 || !instanceName) {
    throw new Error(
      "Set AWS_LIGHTSAIL_STATIC_IP_NAMES (2+ names) and AWS_LIGHTSAIL_INSTANCE_NAME in .env.local",
    );
  }

  const primary =
    process.env.AWS_LIGHTSAIL_PRIMARY_STATIC_IP_NAME?.trim() || pool[0]!;
  const client = new LightsailClient({ region: awsRegion() });
  const listing = await client.send(new GetStaticIpsCommand({}));
  const attached = listing.staticIps?.find((s) => s.attachedTo === instanceName);
  const attachedName = attached?.name?.trim() ?? null;

  if (attachedName === primary) {
    console.log(`[ensure-primary] Already attached: ${primary} (${attached?.ipAddress ?? "?"})`);
    return;
  }

  if (attachedName) {
    console.log(`[ensure-primary] Detaching ${attachedName} …`);
    await client.send(new DetachStaticIpCommand({ staticIpName: attachedName }));
    await sleep(2000);
  }

  console.log(`[ensure-primary] Attaching ${primary} to ${instanceName} …`);
  await client.send(
    new AttachStaticIpCommand({ staticIpName: primary, instanceName }),
  );
  await sleep(1500);
}

async function main(): Promise<void> {
  loadEnvLocal();
  const instanceName = process.env.AWS_LIGHTSAIL_INSTANCE_NAME?.trim();
  const client = new LightsailClient({ region: awsRegion() });
  const before = instanceName ? await fetchAttachedIpv4(client, instanceName) : null;
  const primary =
    process.env.AWS_LIGHTSAIL_PRIMARY_STATIC_IP_NAME?.trim() ||
    parseCsvEnv("AWS_LIGHTSAIL_STATIC_IP_NAMES")[0] ||
    "?";
  console.log(`[ensure-primary] Before: attached=${before ?? "none"}, target=${primary}`);
  await attachPrimary();
  const after = instanceName ? await fetchAttachedIpv4(client, instanceName) : null;
  console.log(`[ensure-primary] After: attached=${after ?? "none"}`);
}

main().catch((e) => {
  console.error("[ensure-primary] Failed:", e instanceof Error ? e.message : e);
  process.exit(1);
});
