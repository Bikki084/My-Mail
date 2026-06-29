import "server-only";

import { isAwsLightsailRotationConfigured } from "@/lib/aws-outbound-ip";
import { parseProxyPool } from "@/lib/smtp-egress-proxy";

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

  if (parseProxyPool().length > 0) return "proxy";
  if (isAwsLightsailRotationConfigured()) return "lightsail";
  return process.env.NODE_ENV === "production" ? "lightsail" : "logical";
}

export function usesLogicalIpPoolOnly(): boolean {
  return resolveEgressMode() === "logical";
}

export function usesLightsailEgressAttach(): boolean {
  return resolveEgressMode() === "lightsail";
}

export function usesProxyEgress(): boolean {
  if (resolveEgressMode() !== "proxy") return false;
  if (parseProxyPool().length > 0) return true;
  return process.env.OUTBOUND_IP_PROXY_AUTO_BIND === "1";
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
