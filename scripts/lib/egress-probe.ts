/**
 * Standalone egress probe (no `server-only` — safe for npx tsx scripts).
 */
import net from "node:net";
import { SocksClient } from "socks";

const IP_V4 =
  /^(?:(?:25[0-5]|2[0-4]\d|[01]?\d{1,2})\.){3}(?:25[0-5]|2[0-4]\d|[01]?\d{1,2})$/;

const PLACEHOLDER = new Set([
  "0.0.0.0",
  "1.2.3.4",
  "5.6.7.8",
  "10.0.0.1",
  "127.0.0.1",
]);

function isPlaceholder(ip: string): boolean {
  if (PLACEHOLDER.has(ip)) return true;
  const p = ip.split(".").map(Number);
  return p[0] === 1 && p[1] === 2 && p[2] === 3;
}

export function resolveEgressModeFromEnv(): string {
  const raw = process.env.OUTBOUND_IP_EGRESS_MODE?.trim().toLowerCase();
  if (raw) return raw;
  if (process.env.OUTBOUND_IP_PROXY_POOL?.trim()) return "proxy";
  if (process.env.OUTBOUND_IP_PROXY_AUTO_BIND === "1") return "proxy";
  if (process.env.AWS_LIGHTSAIL_STATIC_IP_NAMES?.trim()) return "lightsail";
  return "unknown";
}

function isPlaceholderProxy(url: string): boolean {
  const t = url.trim().toLowerCase();
  if (t.startsWith("bind://") || t.startsWith("local://")) return false;
  if (t.includes("real-proxy") || t.includes("proxy1.example")) return true;
  if (t.includes("example.com") || t.includes("user:pass@")) return true;
  try {
    const u = new URL(url.trim());
    if (u.username === "user" && u.password === "pass") return true;
    const host = u.hostname.toLowerCase();
    if (host.includes("example") || host.startsWith("real-proxy")) return true;
  } catch {
    return true;
  }
  return false;
}

export function resolveEgressRoutesFromEnv(): string[] {
  const explicit = process.env.OUTBOUND_IP_PROXY_POOL?.trim();
  if (explicit) {
    const routes = explicit
      .split(",")
      .map((s) => s.trim())
      .filter((s) => Boolean(s) && !isPlaceholderProxy(s));
    if (routes.length > 0) return routes;
  }
  if (process.env.OUTBOUND_IP_PROXY_AUTO_BIND !== "1") return [];
  const raw = process.env.OUTBOUND_IP_POOL?.trim();
  if (!raw) return [];
  const ips = raw
    .split(",")
    .map((s) => s.trim())
    .filter((ip) => IP_V4.test(ip) && !isPlaceholder(ip));
  return ips.map((ip) => `bind://${ip}`);
}

function readHttpBody(socket: net.Socket, timeoutMs = 12_000): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    const timer = setTimeout(() => {
      socket.destroy();
      reject(new Error("timeout"));
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

async function probeBind(localAddress: string): Promise<string | null> {
  return new Promise((resolve) => {
    const socket = net.connect({
      host: "checkip.amazonaws.com",
      port: 80,
      localAddress,
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
      readHttpBody(socket)
        .then((body) => {
          const match = body.match(/\b(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})\b/);
          resolve(match?.[1] ?? null);
        })
        .catch(() => resolve(null));
    });
  });
}

async function probeSocks(proxyUrl: string): Promise<string | null> {
  try {
    const url = new URL(proxyUrl.trim());
    const host = url.hostname;
    const port = url.port ? Number(url.port) : 1080;
    const username = url.username ? decodeURIComponent(url.username) : undefined;
    const password = url.password ? decodeURIComponent(url.password) : undefined;
    const info = await SocksClient.createConnection({
      proxy: {
        host,
        port,
        type: 5,
        ...(username ? { userId: username } : {}),
        ...(password ? { password } : {}),
      },
      command: "connect",
      destination: { host: "checkip.amazonaws.com", port: 80 },
      timeout: 12_000,
    });
    info.socket.write(
      "GET /\r\nHost: checkip.amazonaws.com\r\nConnection: close\r\n\r\n",
    );
    const body = await readHttpBody(info.socket);
    info.socket.destroy();
    const match = body.match(/\b(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})\b/);
    return match?.[1] ?? null;
  } catch {
    return null;
  }
}

export async function probeEgressRoute(route: string): Promise<string | null> {
  const t = route.trim();
  if (t.toLowerCase().startsWith("bind://") || t.toLowerCase().startsWith("local://")) {
    const ip = t.split("//")[1]?.trim() ?? "";
    if (!IP_V4.test(ip)) return null;
    return (await probeBind(ip)) ?? ip;
  }
  return await probeSocks(t);
}
