import "server-only";

import { SocksClient, type SocksClientOptions } from "socks";
import { resolveEgressMode } from "@/lib/egress-mode";

export type ParsedSocksProxy = {
  host: string;
  port: number;
  username?: string;
  password?: string;
};

/** Comma-separated socks5:// URLs — one per plan server slot (10 for 500-credit plan). */
export function parseProxyPool(): string[] {
  const raw = process.env.OUTBOUND_IP_PROXY_POOL?.trim();
  if (!raw) return [];
  return raw
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
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

export function getProxyUrlForSlot(slotIndex: number): string | null {
  const pool = parseProxyPool();
  if (pool.length === 0) return null;
  const idx = Math.max(0, Math.floor(slotIndex)) % pool.length;
  return pool[idx] ?? null;
}

export function isProxyEgressConfigured(): boolean {
  return resolveEgressMode() === "proxy" && parseProxyPool().length > 0;
}

/** Nodemailer `getSocket` — routes SMTP TCP through SOCKS5 (real egress IP = proxy exit). */
export function buildSmtpProxyGetSocket(proxyUrl: string) {
  const parsed = parseSocksProxyUrl(proxyUrl);
  return (
    options: { host?: string; port?: number },
    callback: (err: Error | null, socketOpts?: { connection: import("node:net").Socket }) => void,
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
    })
      .then((info) => callback(null, { connection: info.socket }))
      .catch((err: Error) => callback(err));
  };
}
