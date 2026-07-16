import "server-only";

import { lightsailCircuit } from "@/lib/circuit-breaker";

/**
 * AWS egress IP helpers for Lightsail / EC2 deployments.
 *
 * Default Lightsail behaviour (2+ static IPs): **pool rotation** — the primary
 * static IP stays attached for the website. Refresh cycles the active send IP in
 * the database; during campaigns the send IP is attached for SMTP egress, then
 * the primary is restored when sending finishes.
 *
 * Set `AWS_LIGHTSAIL_SWAP_ATTACH_ON_ROTATE=1` to swap the attached static IP
 * on Refresh (moves the whole server — site URL changes).
 */

const IP_V4 =
  /^(?:(?:25[0-5]|2[0-4]\d|[01]?\d{1,2})\.){3}(?:25[0-5]|2[0-4]\d|[01]?\d{1,2})$/;

const METADATA_BASE = "http://169.254.169.254/latest";

/** Min ms between Lightsail API calls (default 800ms — avoids account rate limits). */
const LIGHTSAIL_API_MIN_INTERVAL_MS = Math.max(
  200,
  Number(process.env.AWS_LIGHTSAIL_API_MIN_INTERVAL_MS) || 800,
);

/** Cache static IP name → address listings (pool rarely changes). */
const POOL_CACHE_TTL_MS = Math.max(
  60_000,
  Number(process.env.AWS_LIGHTSAIL_POOL_CACHE_TTL_MS) || 10 * 60 * 1000,
);

const LISTING_CACHE_TTL_MS = Math.max(
  5_000,
  Number(process.env.AWS_LIGHTSAIL_LISTING_CACHE_TTL_MS) || 45_000,
);

const DETACH_SETTLE_MS = Math.max(
  1500,
  Number(process.env.AWS_LIGHTSAIL_DETACH_SETTLE_MS) || 3000,
);

const ATTACH_SETTLE_MS = Math.max(
  1000,
  Number(process.env.AWS_LIGHTSAIL_ATTACH_SETTLE_MS) || 2500,
);

type LightsailPoolEntry = { name: string; ip: string };

type StaticIpRow = {
  name?: string | null;
  ipAddress?: string | null;
  attachedTo?: string | null;
};

let poolEntriesCache: { at: number; entries: LightsailPoolEntry[] } | null = null;
let staticIpsListingCache: { at: number; rows: StaticIpRow[] } | null = null;
let lightsailClientPromise: Promise<import("@aws-sdk/client-lightsail").LightsailClient> | null =
  null;
let lastLightsailApiAt = 0;
let lightsailApiChain: Promise<unknown> = Promise.resolve();
let lightsailEgressChain: Promise<unknown> = Promise.resolve();

/** Serialize attach/detach across concurrent campaigns (multi-user safe). */
export async function withLightsailEgressLock<T>(fn: () => Promise<T>): Promise<T> {
  const task = () => fn();
  const chained = lightsailEgressChain.then(task, task);
  lightsailEgressChain = chained.then(
    () => undefined,
    () => undefined,
  );
  return chained;
}

function invalidateLightsailCaches(): void {
  poolEntriesCache = null;
  staticIpsListingCache = null;
}

function isLightsailRateLimitError(err: unknown): boolean {
  const msg = (err instanceof Error ? err.message : String(err)).toLowerCase();
  const name =
    err && typeof err === "object" && "name" in err
      ? String((err as { name?: string }).name ?? "").toLowerCase()
      : "";
  return (
    name.includes("throttl") ||
    name.includes("toomany") ||
    msg.includes("maximum api request rate") ||
    msg.includes("rate has been exceeded") ||
    msg.includes("throttl")
  );
}

async function retryLightsailApi<T>(fn: () => Promise<T>, label: string): Promise<T> {
  const maxAttempts = Math.max(2, Number(process.env.AWS_LIGHTSAIL_API_MAX_RETRIES) || 6);
  let lastErr: unknown;
  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    try {
      return await fn();
    } catch (err) {
      lastErr = err;
      if (!isLightsailRateLimitError(err) || attempt >= maxAttempts - 1) throw err;
      const delayMs = Math.min(45_000, 2500 * 2 ** attempt);
      console.warn(
        `[aws-outbound-ip] Lightsail rate limit on ${label}; retry ${attempt + 1}/${maxAttempts - 1} in ${delayMs}ms`,
      );
      await sleep(delayMs);
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error(String(lastErr));
}

async function runLightsailApi<T>(label: string, fn: () => Promise<T>): Promise<T> {
  const task = async () => {
    const waitMs = Math.max(0, LIGHTSAIL_API_MIN_INTERVAL_MS - (Date.now() - lastLightsailApiAt));
    if (waitMs > 0) await sleep(waitMs);
    lastLightsailApiAt = Date.now();
    return lightsailCircuit.execute(() => retryLightsailApi(fn, label));
  };
  const chained = lightsailApiChain.then(task, task);
  lightsailApiChain = chained.then(
    () => undefined,
    () => undefined,
  );
  return chained;
}

async function getLightsailClient(): Promise<import("@aws-sdk/client-lightsail").LightsailClient> {
  if (!lightsailClientPromise) {
    lightsailClientPromise = import("@aws-sdk/client-lightsail").then(
      ({ LightsailClient }) => new LightsailClient({ region: awsRegion() }),
    );
  }
  return lightsailClientPromise;
}

/** Optional: StaticIp-1:1.2.3.4,StaticIp-2:5.6.7.8 — skips pool lookup API calls. */
function readLightsailPoolFromEnvMap(): LightsailPoolEntry[] | null {
  const raw = process.env.AWS_LIGHTSAIL_STATIC_IP_MAP?.trim();
  if (!raw) return null;
  const byName = new Map<string, string>();
  for (const part of raw.split(",")) {
    const colon = part.indexOf(":");
    if (colon <= 0) continue;
    const name = part.slice(0, colon).trim();
    const ip = part.slice(colon + 1).trim();
    if (name && IP_V4.test(ip)) byName.set(name, ip);
  }
  if (byName.size === 0) return null;
  const entries: LightsailPoolEntry[] = [];
  for (const name of getAwsLightsailPool()) {
    const ip = byName.get(name);
    if (ip) entries.push({ name, ip });
  }
  return entries.length >= 2 ? entries : null;
}

async function fetchLightsailStaticIpListing(force = false): Promise<StaticIpRow[]> {
  const now = Date.now();
  if (!force && staticIpsListingCache && now - staticIpsListingCache.at < LISTING_CACHE_TTL_MS) {
    return staticIpsListingCache.rows;
  }
  const client = await getLightsailClient();
  const { GetStaticIpsCommand } = await import("@aws-sdk/client-lightsail");
  const listing = await runLightsailApi("GetStaticIps", () =>
    client.send(new GetStaticIpsCommand({})),
  );
  const rows = listing.staticIps ?? [];
  staticIpsListingCache = { at: now, rows };
  return rows;
}

export type AwsOutboundIpMode =
  | "aws_lightsail"
  | "aws_ec2"
  | "rotation_url"
  | "instance"
  | "dev_stub";

function parseCsvEnv(name: string): string[] {
  const raw = process.env[name]?.trim();
  if (!raw) return [];
  return raw
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

export function getAwsLightsailPool(): string[] {
  return parseCsvEnv("AWS_LIGHTSAIL_STATIC_IP_NAMES");
}

export function getAwsEc2Pool(): string[] {
  return parseCsvEnv("AWS_EC2_ALLOCATION_IDS");
}

export function isAwsLightsailRotationConfigured(): boolean {
  return (
    getAwsLightsailPool().length >= 2 &&
    Boolean(process.env.AWS_LIGHTSAIL_INSTANCE_NAME?.trim())
  );
}

/** Primary static IP — always kept attached so the web app URL stays stable. */
export function getLightsailPrimaryStaticIpName(): string {
  const explicit = process.env.AWS_LIGHTSAIL_PRIMARY_STATIC_IP_NAME?.trim();
  if (explicit) return explicit;
  return getAwsLightsailPool()[0]!;
}

/**
 * Default: cycle pool IPs in the panel/DB without AWS detach (website stays up).
 * Opt-in `AWS_LIGHTSAIL_SWAP_ATTACH_ON_ROTATE=1` swaps the attached static IP.
 */
export function isAwsLightsailPoolRotationEnabled(): boolean {
  return (
    isAwsLightsailRotationConfigured() &&
    process.env.AWS_LIGHTSAIL_SWAP_ATTACH_ON_ROTATE !== "1"
  );
}

export function isAwsEc2RotationConfigured(): boolean {
  return (
    getAwsEc2Pool().length >= 2 && Boolean(process.env.AWS_EC2_INSTANCE_ID?.trim())
  );
}

export function isRotationUrlConfigured(): boolean {
  return Boolean(process.env.OUTBOUND_IP_ROTATION_URL?.trim());
}

export function useInstancePublicIpMode(): boolean {
  if (process.env.OUTBOUND_IP_USE_INSTANCE_IP === "1") return true;
  if (isAwsLightsailRotationConfigured() || isAwsEc2RotationConfigured()) {
    return true;
  }
  if (process.env.NODE_ENV === "production" && !isRotationUrlConfigured()) {
    return true;
  }
  return false;
}

export function resolveOutboundIpMode(): AwsOutboundIpMode {
  if (isRotationUrlConfigured()) return "rotation_url";
  if (isAwsLightsailRotationConfigured()) return "aws_lightsail";
  if (isAwsEc2RotationConfigured()) return "aws_ec2";
  if (useInstancePublicIpMode()) return "instance";
  return "dev_stub";
}

async function fetchImdsToken(): Promise<string | null> {
  try {
    const res = await fetch(`${METADATA_BASE}/api/token`, {
      method: "PUT",
      headers: { "X-aws-ec2-metadata-token-ttl-seconds": "60" },
      signal: AbortSignal.timeout(1500),
    });
    if (!res.ok) return null;
    const token = (await res.text()).trim();
    return token || null;
  } catch {
    return null;
  }
}

/** Read the instance public IPv4 from the AWS metadata service (IMDSv2/v1). */
export async function fetchInstancePublicIpv4(): Promise<string> {
  const token = await fetchImdsToken();
  const headers: Record<string, string> = {};
  if (token) headers["X-aws-ec2-metadata-token"] = token;

  try {
    const res = await fetch(`${METADATA_BASE}/meta-data/public-ipv4`, {
      headers,
      signal: AbortSignal.timeout(3000),
    });
    if (res.ok) {
      const ip = (await res.text()).trim();
      if (IP_V4.test(ip)) return ip;
    }
  } catch {
    /* fall through */
  }

  try {
    const res = await fetch("https://api.ipify.org?format=json", {
      signal: AbortSignal.timeout(5000),
      cache: "no-store",
    });
    if (res.ok) {
      const j = (await res.json()) as { ip?: string };
      const ip = j.ip?.trim() ?? "";
      if (IP_V4.test(ip)) return ip;
    }
  } catch {
    /* fall through */
  }

  throw new Error(
    "Could not determine the server public IP. On AWS, ensure IMDS is enabled or set OUTBOUND_IP_ROTATION_URL.",
  );
}

async function sleep(ms: number): Promise<void> {
  await new Promise((r) => setTimeout(r, ms));
}

async function waitForPublicIpChange(
  previousIp: string | null,
  timeoutMs = 25_000,
): Promise<string> {
  const deadline = Date.now() + timeoutMs;
  let last = previousIp ?? "";
  while (Date.now() < deadline) {
    const ip = await fetchLivePublicIpv4();
    if (!previousIp || ip !== previousIp) return ip;
    last = ip;
    await sleep(2000);
  }
  throw new Error(
    `Timed out waiting for a new public IP (still ${last || "unknown"}). Check AWS static IP / Elastic IP pool.`,
  );
}

/** Read the static IP currently attached to the Lightsail instance (authoritative for egress). */
export async function fetchLightsailAttachedStaticIpv4(): Promise<string | null> {
  const instanceName = process.env.AWS_LIGHTSAIL_INSTANCE_NAME?.trim();
  if (!instanceName) return null;
  try {
    const rows = await fetchLightsailStaticIpListing();
    const attached = rows.find((s) => s.attachedTo === instanceName);
    const ip = attached?.ipAddress?.trim() ?? "";
    return IP_V4.test(ip) ? ip : null;
  } catch {
    return null;
  }
}

async function fetchEc2AttachedElasticIpv4(): Promise<string | null> {
  const instanceId = process.env.AWS_EC2_INSTANCE_ID?.trim();
  if (!instanceId) return null;
  try {
    const { EC2Client, DescribeAddressesCommand } =
      await import("@aws-sdk/client-ec2");
    const client = new EC2Client({ region: awsRegion() });
    const listed = await client.send(new DescribeAddressesCommand({}));
    const attached = listed.Addresses?.find((a) => a.InstanceId === instanceId);
    const ip = attached?.PublicIp?.trim() ?? "";
    return IP_V4.test(ip) ? ip : null;
  } catch {
    return null;
  }
}

/**
 * Best-effort live egress IP: Lightsail/EC2 API first (authoritative), then IMDS/ipify.
 */
export async function fetchLivePublicIpv4(): Promise<string> {
  const lightsail = await fetchLightsailAttachedStaticIpv4();
  if (lightsail) return lightsail;
  const ec2 = await fetchEc2AttachedElasticIpv4();
  if (ec2) return ec2;
  return fetchInstancePublicIpv4();
}

function awsRegion(): string {
  return (
    process.env.AWS_LIGHTSAIL_REGION?.trim() ||
    process.env.AWS_REGION?.trim() ||
    process.env.AWS_DEFAULT_REGION?.trim() ||
    "us-east-1"
  );
}

async function fetchLightsailPoolEntries(): Promise<LightsailPoolEntry[]> {
  const now = Date.now();
  if (poolEntriesCache && now - poolEntriesCache.at < POOL_CACHE_TTL_MS) {
    return poolEntriesCache.entries;
  }

  const fromEnv = readLightsailPoolFromEnvMap();
  if (fromEnv) {
    poolEntriesCache = { at: now, entries: fromEnv };
    return fromEnv;
  }

  const pool = getAwsLightsailPool();
  const rows = await fetchLightsailStaticIpListing();
  const byName = new Map<string, StaticIpRow>();
  for (const row of rows) {
    const name = row.name?.trim();
    if (name) byName.set(name, row);
  }
  const entries: LightsailPoolEntry[] = [];
  for (const name of pool) {
    const row = byName.get(name);
    const ip = row?.ipAddress?.trim() ?? "";
    if (IP_V4.test(ip)) entries.push({ name, ip });
  }
  if (entries.length < 2) {
    throw new Error(
      "Could not read 2+ Lightsail static IP addresses from AWS. Check AWS_LIGHTSAIL_STATIC_IP_NAMES and IAM permissions.",
    );
  }
  poolEntriesCache = { at: now, entries };
  return entries;
}

export async function fetchLightsailPoolIpv4List(): Promise<string[]> {
  const entries = await fetchLightsailPoolEntries();
  return entries.map((e) => e.ip);
}

/** Send pool = all configured static IPs except the website primary. */
export async function fetchLightsailSendPoolIpv4List(): Promise<string[]> {
  const entries = await fetchLightsailPoolEntries();
  const primaryName = getLightsailPrimaryStaticIpName();
  const primaryIp = entries.find((e) => e.name === primaryName)?.ip ?? null;
  const allIps = entries.map((e) => e.ip);
  if (!primaryIp) return allIps;
  const sendIps = allIps.filter((ip) => ip !== primaryIp);
  return sendIps.length > 0 ? sendIps : allIps;
}

/** Website primary IPv4 — attached instance IP first (one cached listing call). */
export async function resolveLightsailWebsitePrimaryIpv4(): Promise<string | null> {
  const attached = await fetchLightsailAttachedStaticIpv4();
  if (attached) return attached;
  return fetchLightsailWebsiteIpv4();
}

/** Cycle send IP across the pool without detaching the website's primary static IP. */
async function rotateLightsailPoolLogical(previousIp: string | null): Promise<string> {
  const sendIps = await fetchLightsailSendPoolIpv4List();
  if (sendIps.length === 0) {
    throw new Error("No send IPs configured in AWS_LIGHTSAIL_STATIC_IP_NAMES.");
  }
  const websiteIp = (await resolveLightsailWebsitePrimaryIpv4())?.trim() ?? null;
  const prev = previousIp?.trim() || null;

  // On primary (panel default): first Refresh picks the first send IP (IP-2).
  if (!prev || (websiteIp && prev === websiteIp)) {
    return sendIps[0]!;
  }

  const idx = sendIps.indexOf(prev);
  return sendIps[(idx >= 0 ? idx + 1 : 0) % sendIps.length]!;
}

/**
 * Keep the primary static IP attached so inbound HTTP/SSH stays on one address.
 * Safe to call on panel load after a legacy full-swap rotation.
 */
const LIGHTSAIL_ATTACH_TIMEOUT_MS = Math.min(
  60_000,
  Math.max(15_000, Number(process.env.AWS_LIGHTSAIL_ATTACH_TIMEOUT_MS) || 45_000),
);

async function attachLightsailStaticIpByName(
  staticIpName: string,
  instanceName: string,
): Promise<void> {
  const work = async () => {
    const rows = await fetchLightsailStaticIpListing();
    const attached = rows.find((s) => s.attachedTo === instanceName);
    const attachedName = attached?.name?.trim() ?? null;
    if (attachedName === staticIpName) return;

    const client = await getLightsailClient();
    const { AttachStaticIpCommand, DetachStaticIpCommand } =
      await import("@aws-sdk/client-lightsail");

    if (attachedName) {
      await runLightsailApi(`DetachStaticIp:${attachedName}`, () =>
        client.send(new DetachStaticIpCommand({ staticIpName: attachedName })),
      );
      invalidateLightsailCaches();
      await sleep(DETACH_SETTLE_MS);
    }
    await runLightsailApi(`AttachStaticIp:${staticIpName}`, () =>
      client.send(new AttachStaticIpCommand({ staticIpName, instanceName })),
    );
    invalidateLightsailCaches();
    await sleep(ATTACH_SETTLE_MS);
  };

  await Promise.race([
    work(),
    new Promise<never>((_, reject) => {
      setTimeout(
        () =>
          reject(
            new Error(
              `Lightsail attach "${staticIpName}" timed out after ${LIGHTSAIL_ATTACH_TIMEOUT_MS}ms. Check AWS credentials and static IP names.`,
            ),
          ),
        LIGHTSAIL_ATTACH_TIMEOUT_MS,
      );
    }),
  ]);
}

export async function ensureLightsailPrimaryStaticIpAttached(): Promise<void> {
  if (!isAwsLightsailRotationConfigured()) return;
  const primary = getLightsailPrimaryStaticIpName();
  const instanceName = process.env.AWS_LIGHTSAIL_INSTANCE_NAME!.trim();
  await attachLightsailStaticIpByName(primary, instanceName);
}

/**
 * Attach the pool IP used for SMTP egress. The website primary is restored after
 * the campaign via `releaseLightsailEgressToPrimary`.
 */
export async function ensureLightsailEgressIpForSend(targetIp: string): Promise<void> {
  if (!isAwsLightsailRotationConfigured()) return;
  const wanted = targetIp.trim();
  if (!IP_V4.test(wanted)) return;

  const entries = await fetchLightsailPoolEntries();
  const entry = entries.find((e) => e.ip === wanted);
  if (!entry) {
    throw new Error(
      `Send IP ${wanted} is not in AWS_LIGHTSAIL_STATIC_IP_NAMES. Known pool: ${entries.map((e) => e.ip).join(", ")}.`,
    );
  }

  const instanceName = process.env.AWS_LIGHTSAIL_INSTANCE_NAME!.trim();
  await attachLightsailStaticIpByName(entry.name, instanceName);
  console.log(
    `[aws-outbound-ip] SMTP egress attached ${entry.name} (${entry.ip}) on ${instanceName}`,
  );
}

/** After a send batch, put the website primary static IP back on the instance. */
export async function releaseLightsailEgressToPrimary(): Promise<void> {
  if (!isAwsLightsailPoolRotationEnabled()) return;
  await ensureLightsailPrimaryStaticIpAttached();
  console.log("[aws-outbound-ip] restored primary static IP for website access");
}

export async function fetchLightsailWebsiteIpv4(): Promise<string | null> {
  if (!isAwsLightsailRotationConfigured()) {
    return fetchLightsailAttachedStaticIpv4();
  }
  try {
    const entries = await fetchLightsailPoolEntries();
    const primary = getLightsailPrimaryStaticIpName();
    const row = entries.find((e) => e.name === primary);
    return row?.ip ?? (await fetchLightsailAttachedStaticIpv4());
  } catch {
    return fetchLightsailAttachedStaticIpv4();
  }
}

async function rotateLightsailStaticIp(previousIp: string | null): Promise<string> {
  const pool = getAwsLightsailPool();
  const instanceName = process.env.AWS_LIGHTSAIL_INSTANCE_NAME!.trim();
  const { LightsailClient, GetStaticIpsCommand, AttachStaticIpCommand, DetachStaticIpCommand } =
    await import("@aws-sdk/client-lightsail");

  const client = new LightsailClient({ region: awsRegion() });
  const listing = await client.send(new GetStaticIpsCommand({}));
  const staticIps = listing.staticIps ?? [];

  const attached = staticIps.find((s) => s.attachedTo === instanceName);
  const attachedName = attached?.name?.trim() ?? null;
  const attachedIdx = attachedName ? pool.indexOf(attachedName) : -1;
  const nextName =
    pool[(attachedIdx >= 0 ? attachedIdx + 1 : 0) % pool.length]!;

  if (attachedName && attachedName !== nextName) {
    await client.send(new DetachStaticIpCommand({ staticIpName: attachedName }));
    await sleep(3000);
  }

  if (!attachedName || attachedName !== nextName) {
    await client.send(
      new AttachStaticIpCommand({ staticIpName: nextName, instanceName }),
    );
    await sleep(2000);
  }

  const { GetStaticIpCommand } = await import("@aws-sdk/client-lightsail");
  const detail = await client.send(new GetStaticIpCommand({ staticIpName: nextName }));
  const apiIp = detail.staticIp?.ipAddress?.trim() ?? "";
  if (IP_V4.test(apiIp)) {
    if (previousIp && apiIp === previousIp) {
      throw new Error(
        `Lightsail static IP "${nextName}" attached but address did not change (${apiIp}).`,
      );
    }
    return apiIp;
  }

  const ip = await waitForPublicIpChange(previousIp);
  if (previousIp && ip === previousIp) {
    throw new Error(
      `Lightsail static IP "${nextName}" attached but public IP did not change (${ip}).`,
    );
  }
  return ip;
}

async function rotateEc2ElasticIp(previousIp: string | null): Promise<string> {
  const pool = getAwsEc2Pool();
  const instanceId = process.env.AWS_EC2_INSTANCE_ID!.trim();
  const { EC2Client, DescribeAddressesCommand, AssociateAddressCommand, DisassociateAddressCommand } =
    await import("@aws-sdk/client-ec2");

  const client = new EC2Client({ region: awsRegion() });
  const listed = await client.send(new DescribeAddressesCommand({}));
  const addresses = listed.Addresses ?? [];

  const attached = addresses.find((a) => a.InstanceId === instanceId);
  const attachedAlloc = attached?.AllocationId?.trim() ?? null;
  const attachedIdx = attachedAlloc ? pool.indexOf(attachedAlloc) : -1;
  const nextAlloc =
    pool[(attachedIdx >= 0 ? attachedIdx + 1 : 0) % pool.length]!;

  const associationId = attached?.AssociationId;
  if (attachedAlloc && associationId) {
    await client.send(
      new DisassociateAddressCommand({ AssociationId: associationId }),
    );
    await sleep(3000);
  }

  await client.send(
    new AssociateAddressCommand({
      AllocationId: nextAlloc,
      InstanceId: instanceId,
    }),
  );
  await sleep(2000);

  const refreshed = await client.send(new DescribeAddressesCommand({}));
  const nextAddr = refreshed.Addresses?.find((a) => a.AllocationId === nextAlloc);
  const apiIp = nextAddr?.PublicIp?.trim() ?? "";
  if (IP_V4.test(apiIp)) {
    if (previousIp && apiIp === previousIp) {
      throw new Error(
        `EC2 Elastic IP ${nextAlloc} associated but address did not change (${apiIp}).`,
      );
    }
    return apiIp;
  }

  const ip = await waitForPublicIpChange(previousIp);
  if (previousIp && ip === previousIp) {
    throw new Error(
      `EC2 Elastic IP ${nextAlloc} associated but public IP did not change (${ip}).`,
    );
  }
  return ip;
}

/**
 * Rotate egress IP using AWS (Lightsail static IP pool or EC2 Elastic IP pool).
 */
export async function rotateAwsOutboundIp(previousIp: string | null): Promise<string> {
  if (isAwsLightsailRotationConfigured()) {
    if (isAwsLightsailPoolRotationEnabled()) {
      // Panel rotate: DB only — never detach/attach on AWS (website stays up).
      return rotateLightsailPoolLogical(previousIp);
    }
    return rotateLightsailStaticIp(previousIp);
  }
  if (isAwsEc2RotationConfigured()) {
    return rotateEc2ElasticIp(previousIp);
  }
  throw new Error(
    "AWS IP rotation is not configured. Set AWS_LIGHTSAIL_STATIC_IP_NAMES (2+) and AWS_LIGHTSAIL_INSTANCE_NAME, or AWS_EC2_ALLOCATION_IDS (2+) and AWS_EC2_INSTANCE_ID.",
  );
}
