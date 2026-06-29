import "server-only";

import net from "node:net";
import { SocksClient, type SocksClientOptions } from "socks";
import { resolveEgressMode } from "@/lib/egress-mode";
import { fetchPlanIpMaster } from "@/lib/outbound-ip-pool";

const IP_V4 =
  /^(?:(?:25[0-5]|2[0-4]\d|[01]?\d{1,2})\.){3}(?:25[0-5]|2[0-4]\d|[01]?\d{1,2})$/;

const EXIT_IP_CACHE_TTL_MS = 10 * 60 * 1000;
const exitIpCache = new Map<string, { ip: string; at: number }>();

export type ParsedSocksProxy = {
  host: string;
  port: number;
  username?: string;
  password?: string;
};

/** Comma-separated socks5:// or bind:// URLs — one per plan server slot. */
export function isDocumentationPlaceholderProxyUrl(url: string): boolean {
  const t = url.trim().toLowerCase();
  if (!t) return true;
  if (isBindEgressUrl(t)) return false;
  if (t.includes("real-proxy") || t.includes("proxy1.example") || t.includes("proxy2.example")) {
    return true;
  }
  if (t.includes("example.com") || t.includes("@example")) return true;
  if (t.includes("user:pass@") || t.includes("//user:pass")) return true;
  try {
    const u = new URL(url.trim());
    const host = u.hostname.toLowerCase();
    if (host === "localhost" || host === "127.0.0.1") return false;
    if (host.startsWith("real-proxy") || host.includes("example")) return true;
    if (u.username === "user" && u.password === "pass") return true;
  } catch {
    return true;
  }
  return false;
}

export function parseProxyPool(): string[] {
  const raw = process.env.OUTBOUND_IP_PROXY_POOL?.trim();
  if (!raw) return [];
  return raw
    .split(",")
    .map((s) => s.trim())
    .filter((s) => Boolean(s) && !isDocumentationPlaceholderProxyUrl(s));
}

export function isBindEgressUrl(url: string): boolean {
  const t = url.trim().toLowerCase();
  return t.startsWith("bind://") || t.startsWith("local://");
}

export function parseBindEgressIp(url: string): string {
  const trimmed = url.trim();
  const lower = trimmed.toLowerCase();
  const prefix = lower.startsWith("bind://")
    ? "bind://"
    : lower.startsWith("local://")
      ? "local://"
      : null;
  if (!prefix) {
    throw new Error(`Invalid bind URL: ${trimmed.slice(0, 80)}`);
  }
  const ip = trimmed.slice(prefix.length).trim();
  if (!IP_V4.test(ip)) {
    throw new Error(`Invalid bind IP in ${trimmed.slice(0, 80)}`);
  }
  return ip;
}

export function parseSocksProxyUrl(proxyUrl: string): ParsedSocksProxy {
  const trimmed = proxyUrl.trim();
  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    throw new Error(`Invalid proxy URL: ${trimmed.slice(0, 80)}`);
  }
  const scheme = url.protocol.replace(":", "").toLowerCase();
  if (scheme !== "socks5" && scheme !== "socks" && scheme !== "socks5h") {
    throw new Error(`Proxy must be socks5:// (got ${scheme}://)`);
  }
  const host = url.hostname;
  const port = url.port ? Number(url.port) : 1080;
  if (!host || !Number.isFinite(port) || port <= 0) {
    throw new Error(`Invalid proxy host/port in ${trimmed.slice(0, 80)}`);
  }
  const username = url.username ? decodeURIComponent(url.username) : undefined;
  const password = url.password ? decodeURIComponent(url.password) : undefined;
  return { host, port, username, password };
}

/**
 * Resolved egress routes: explicit OUTBOUND_IP_PROXY_POOL, or auto bind:// for each AWS IP.
 */
export async function resolveEgressProxyPool(): Promise<string[]> {
  const fromEnv = parseProxyPool();
  if (fromEnv.length > 0) return fromEnv;
  if (process.env.OUTBOUND_IP_PROXY_AUTO_BIND !== "1") return [];
  const ips = await fetchPlanIpMaster();
  return ips.map((ip) => `bind://${ip}`);
}

export async function getEgressProxyUrlForSlot(slotIndex: number): Promise<string | null> {
  const pool = await resolveEgressProxyPool();
  if (pool.length === 0) return null;
  const idx = Math.max(0, Math.floor(slotIndex)) % pool.length;
  return pool[idx] ?? null;
}

/** @deprecated Use getEgressProxyUrlForSlot — sync helper when pool is only in env. */
export function getProxyUrlForSlot(slotIndex: number): string | null {
  const pool = parseProxyPool();
  if (pool.length === 0) return null;
  const idx = Math.max(0, Math.floor(slotIndex)) % pool.length;
  return pool[idx] ?? null;
}

export function isProxyEgressConfigured(): boolean {
  if (resolveEgressMode() !== "proxy") return false;
  if (parseProxyPool().length > 0) return true;
  return process.env.OUTBOUND_IP_PROXY_AUTO_BIND === "1";
}

function readHttpResponseBody(socket: net.Socket, timeoutMs = 12_000): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    const timer = setTimeout(() => {
      socket.destroy();
      reject(new Error("Exit IP probe timed out."));
    }, timeoutMs);
    const finish = (err?: Error) => {
      clearTimeout(timer);
      if (err) reject(err);
      else resolve(Buffer.concat(chunks).toString("utf8"));
    };
    socket.on("data", (c) => chunks.push(c));
    socket.on("end", () => finish());
    socket.on("error", (e) => finish(e instanceof Error ? e : new Error(String(e))));
  });
}

async function probeExitViaHttp(localAddress?: string): Promise<string | null> {
  return new Promise((resolve) => {
    const socket = net.connect({
      host: "checkip.amazonaws.com",
      port: 80,
      ...(localAddress ? { localAddress } : {}),
    });
    socket.setTimeout(12_000);
    socket.once("timeout", () => {
      socket.destroy();
      resolve(null);
    });
    socket.once("error", () => resolve(null));
    socket.once("connect", () => {
      socket.write(
        "GET /\r\nHost: checkip.amazonaws.com\r\nConnection: close\r\n\r\n",
      );
      readHttpResponseBody(socket)
        .then((body) => {
          const match = body.match(/\b(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})\b/);
          resolve(match?.[1] ?? null);
        })
        .catch(() => resolve(null));
    });
  });
}

async function probeSocksExitIpv4(proxyUrl: string): Promise<string | null> {
  try {
    const parsed = parseSocksProxyUrl(proxyUrl);
    const proxy: SocksClientOptions["proxy"] = {
      host: parsed.host,
      port: parsed.port,
      type: 5,
      ...(parsed.username ? { userId: parsed.username } : {}),
      ...(parsed.password ? { password: parsed.password } : {}),
    };
    const info = await SocksClient.createConnection({
      proxy,
      command: "connect",
      destination: { host: "checkip.amazonaws.com", port: 80 },
      timeout: 12_000,
    });
    info.socket.write(
      "GET /\r\nHost: checkip.amazonaws.com\r\nConnection: close\r\n\r\n",
    );
    const body = await readHttpResponseBody(info.socket);
    info.socket.destroy();
    const match = body.match(/\b(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})\b/);
    return match?.[1] ?? null;
  } catch {
    return null;
  }
}

/** Probe or infer the public IPv4 seen when egressing through this route. */
export async function resolveExitIpv4ForEgressUrl(
  egressUrl: string,
  force = false,
): Promise<string | null> {
  const key = egressUrl.trim();
  if (!key) return null;

  if (!force) {
    const cached = exitIpCache.get(key);
    if (cached && Date.now() - cached.at < EXIT_IP_CACHE_TTL_MS) {
      return cached.ip;
    }
  }

  let ip: string | null = null;
  if (isBindEgressUrl(key)) {
    const bindIp = parseBindEgressIp(key);
    ip = (await probeExitViaHttp(bindIp)) ?? bindIp;
  } else {
    ip = await probeSocksExitIpv4(key);
  }

  if (ip && IP_V4.test(ip)) {
    exitIpCache.set(key, { ip, at: Date.now() });
    return ip;
  }
  return null;
}

/** Exit IPv4 for a plan SMTP slot (probes proxy / bind route). */
export async function resolveExitIpv4ForSlot(
  slotIndex: number,
  force = false,
): Promise<string | null> {
  const url = await getEgressProxyUrlForSlot(slotIndex);
  if (!url) return null;
  return await resolveExitIpv4ForEgressUrl(url, force);
}

/** Nodemailer `getSocket` — TCP egress bound to a specific local IPv4. */
export function buildSmtpBindGetSocket(localAddress: string) {
  const bindIp = localAddress.trim();
  return (
    options: { host?: string; port?: number },
    callback: (err: Error | null, socketOpts?: { connection: net.Socket }) => void,
  ) => {
    const destHost = options.host ?? "";
    const destPort = options.port ?? 587;
    if (!destHost) {
      callback(new Error("SMTP destination host missing for bind connection."));
      return;
    }
    const socket = net.connect({
      host: destHost,
      port: destPort,
      localAddress: bindIp,
    });
    socket.once("connect", () => callback(null, { connection: socket }));
    socket.once("error", (err: Error) => callback(err));
  };
}

/** Nodemailer `getSocket` — routes SMTP TCP through SOCKS5. */
export function buildSmtpProxyGetSocket(proxyUrl: string) {
  const parsed = parseSocksProxyUrl(proxyUrl);
  return (
    options: { host?: string; port?: number },
    callback: (err: Error | null, socketOpts?: { connection: net.Socket }) => void,
  ) => {
    const destHost = options.host ?? "";
    const destPort = options.port ?? 587;
    if (!destHost) {
      callback(new Error("SMTP destination host missing for proxy connection."));
      return;
    }
    const proxy: SocksClientOptions["proxy"] = {
      host: parsed.host,
      port: parsed.port,
      type: 5,
      ...(parsed.username ? { userId: parsed.username } : {}),
      ...(parsed.password ? { password: parsed.password } : {}),
    };
    SocksClient.createConnection({
      proxy,
      command: "connect",
      destination: { host: destHost, port: destPort },
      timeout: 15_000,
    })
      .then((info) => callback(null, { connection: info.socket }))
      .catch((err: Error) => callback(err));
  };
}

/** SOCKS5 or bind:// — real egress for SMTP. */
export function buildSmtpEgressGetSocket(egressUrl: string) {
  if (isBindEgressUrl(egressUrl)) {
    return buildSmtpBindGetSocket(parseBindEgressIp(egressUrl));
  }
  return buildSmtpProxyGetSocket(egressUrl);
}

/** Verify proxy/bind routes before a campaign and log exit IPs. */
export async function verifyEgressProxyPool(): Promise<{
  ok: boolean;
  routes: Array<{ url: string; exitIp: string | null }>;
}> {
  const pool = await resolveEgressProxyPool();
  const routes: Array<{ url: string; exitIp: string | null }> = [];
  for (const url of pool) {
    const exitIp = await resolveExitIpv4ForEgressUrl(url, true);
    routes.push({ url: isBindEgressUrl(url) ? `bind ${parseBindEgressIp(url)}` : url, exitIp });
  }
  const ok = routes.some((r) => r.exitIp != null);
  return { ok, routes };
}
