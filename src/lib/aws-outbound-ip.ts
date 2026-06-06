import "server-only";

/**
 * AWS egress IP helpers for Lightsail / EC2 deployments.
 *
 * When `AWS_LIGHTSAIL_STATIC_IP_NAMES` or `AWS_EC2_ALLOCATION_IDS` is set,
 * rotation detaches the current address and attaches the next one in the pool.
 * New SMTP connections then egress from the new public IP automatically.
 */

const IP_V4 =
  /^(?:(?:25[0-5]|2[0-4]\d|[01]?\d{1,2})\.){3}(?:25[0-5]|2[0-4]\d|[01]?\d{1,2})$/;

const METADATA_BASE = "http://169.254.169.254/latest";

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
  timeoutMs = 90_000,
): Promise<string> {
  const deadline = Date.now() + timeoutMs;
  let last = previousIp ?? "";
  while (Date.now() < deadline) {
    const ip = await fetchInstancePublicIpv4();
    if (!previousIp || ip !== previousIp) return ip;
    last = ip;
    await sleep(2500);
  }
  throw new Error(
    `Timed out waiting for a new public IP (still ${last || "unknown"}). Check AWS static IP / Elastic IP pool.`,
  );
}

function awsRegion(): string {
  return (
    process.env.AWS_LIGHTSAIL_REGION?.trim() ||
    process.env.AWS_REGION?.trim() ||
    process.env.AWS_DEFAULT_REGION?.trim() ||
    "us-east-1"
  );
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
    return rotateLightsailStaticIp(previousIp);
  }
  if (isAwsEc2RotationConfigured()) {
    return rotateEc2ElasticIp(previousIp);
  }
  throw new Error(
    "AWS IP rotation is not configured. Set AWS_LIGHTSAIL_STATIC_IP_NAMES (2+) and AWS_LIGHTSAIL_INSTANCE_NAME, or AWS_EC2_ALLOCATION_IDS (2+) and AWS_EC2_INSTANCE_ID.",
  );
}
