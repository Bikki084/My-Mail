import "server-only";

import {
  isAwsLightsailPoolRotationEnabled,
  isAwsLightsailRotationConfigured,
} from "@/lib/aws-outbound-ip";

function isBindOnlyProxyUrl(url: string): boolean {
  const t = url.trim().toLowerCase();
  return t.startsWith("bind://") || t.startsWith("local://");
}

function parseProxyPoolFromEnv(): string[] {
  const raw = process.env.OUTBOUND_IP_PROXY_POOL?.trim();
  if (!raw) return [];
  return raw.split(",").map((s) => s.trim()).filter(Boolean);
}

/**
 * How outbound IP rotation affects real network egress.
 *
 * - logical: UI + DB only (synthetic IPs allowed). No AWS attach, no proxy.
 * - lightsail: Real AWS static IP attach on this VPS before sends (max ~5 IPs per instance).
 * - proxy: Each SMTP worker uses a SOCKS5 proxy from OUTBOUND_IP_PROXY_POOL (true parallel egress).
 */
export type EgressMode = "logical" | "lightsail" | "proxy";

export function resolveEgressMode(): EgressMode {
  const raw = process.env.OUTBOUND_IP_EGRESS_MODE?.trim().toLowerCase();
  if (raw === "logical" || raw === "ui" || raw === "virtual") return "logical";
  if (raw === "proxy" || raw === "socks" || raw === "socks5") return "proxy";
  if (raw === "lightsail" || raw === "aws" || raw === "real") return "lightsail";

  if (parseProxyPoolFromEnv().length > 0) return "proxy";
  // Default Lightsail (2+ static IPs): UI pool rotation only — never attach alternate IPs on send.
  if (isAwsLightsailRotationConfigured() && isAwsLightsailPoolRotationEnabled()) {
    return "logical";
  }
  if (isAwsLightsailRotationConfigured()) return "lightsail";
  return process.env.NODE_ENV === "production" ? "lightsail" : "logical";
}

export function usesLogicalIpPoolOnly(): boolean {
  return resolveEgressMode() === "logical";
}

/** Real AWS attach during sends (cycles 5 static IPs; primary restored when idle). */
export function usesLightsailSendEgress(): boolean {
  return (
    process.env.AWS_LIGHTSAIL_SEND_EGRESS === "1" &&
    isAwsLightsailRotationConfigured()
  );
}

export function usesLightsailEgressAttach(): boolean {
  if (usesLightsailSendEgress()) return true;
  if (resolveEgressMode() !== "lightsail") return false;
  // Pool rotation keeps the website on the primary static IP — no AWS swap during sends.
  if (isAwsLightsailPoolRotationEnabled()) return false;
  return true;
}

export function usesProxyEgress(): boolean {
  if (resolveEgressMode() !== "proxy") return false;
  const bindOk = !isAwsLightsailRotationConfigured();
  const pool = parseProxyPoolFromEnv().filter(
    (url) => !isBindOnlyProxyUrl(url) || bindOk,
  );
  if (pool.length > 0) return true;
  if (process.env.OUTBOUND_IP_PROXY_AUTO_BIND === "1") {
    return bindOk;
  }
  return false;
}

export function egressModeLabel(mode: EgressMode): string {
  switch (mode) {
    case "lightsail":
      return "AWS Lightsail (real attach)";
    case "proxy":
      return "SOCKS5 proxy (real egress per server)";
    case "logical":
    default:
      return "Logical only (UI tracking)";
  }
}
