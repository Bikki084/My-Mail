import nodemailer, { type Transporter, type TransportOptions } from "nodemailer";
import { getDkimConfigFromEnv } from "@/lib/deliverability";
import { parsePositiveIntEnv } from "@/lib/async-pool";
import { isSesSmtpHost, isBrevoSmtpHost, isZohoSmtpHost } from "@/lib/smtp/from-address";
import { buildSmtpEgressGetSocket, shouldApplySmtpEgress } from "@/lib/smtp-egress-proxy";

/** Loopback relays (e.g. Postfix on the same VPS as the app). */
export function isLocalSmtpHost(host: string): boolean {
  const h = host.trim().toLowerCase();
  return h === "localhost" || h === "127.0.0.1" || h === "::1";
}

type SmtpConnectionExtras = {
  ignoreTLS?: boolean;
  tls?: { rejectUnauthorized: boolean };
};

/**
 * Local Postfix often advertises STARTTLS with a self-signed cert. On loopback port 25
 * we skip TLS entirely; otherwise accept self-signed for local submission ports.
 */
export function smtpConnectionExtras(host: string, port: number): SmtpConnectionExtras {
  if (!isLocalSmtpHost(host)) return {};
  if (port === 25) return { ignoreTLS: true };
  return { tls: { rejectUnauthorized: false } };
}

/** Local Postfix on loopback does not use SMTP AUTH — skip credentials. */
export function smtpAuthOptions(
  host: string,
  username: string,
  password: string,
): { auth?: { user: string; pass: string } } {
  if (isLocalSmtpHost(host)) return {};
  return { auth: { user: username, pass: password } };
}

/**
 * Nodemailer `secure` = implicit TLS. Port 25 is plain SMTP (never implicit TLS).
 * Port 587 uses STARTTLS with secure:false; only 465 uses secure:true.
 */
export function resolveSmtpImplicitTls(host: string, port: number, secure: boolean): boolean {
  if (port === 465) return true;
  if (port === 587 || port === 25) return false;
  if (isLocalSmtpHost(host)) return false;
  return secure;
}

/**
 * Nodemailer transport for user SMTP, matching server actions' host/port/secure rules
 * (Gmail/587 STARTTLS, 465 implicit TLS, etc.).
 *
 * Pooling is enabled by default for bulk sends — reuse TLS sessions instead of
 * opening a new connection per message.
 */
export function buildSmtpUserTransport(v: {
  host: string;
  port: number;
  secure: boolean;
  username: string;
  password: string;
  /** SOCKS5 or bind:// URL — routes this SMTP connection through real egress. */
  egressUrl?: string | null;
}): Transporter {
  const usesImplicitTls = resolveSmtpImplicitTls(v.host, v.port, v.secure);
  // SES (and most public relays) DKIM-sign on their side — skip in-process signing.
  const dkim =
    isSesSmtpHost(v.host) || isBrevoSmtpHost(v.host) || isZohoSmtpHost(v.host) ? null : getDkimConfigFromEnv();
  const rawEgressUrl = v.egressUrl?.trim() || null;
  const egressUrl =
    rawEgressUrl && shouldApplySmtpEgress(v.host, rawEgressUrl) ? rawEgressUrl : null;
  const poolEnabled = process.env.SMTP_POOL !== "0" && !egressUrl;
  const maxConnections = parsePositiveIntEnv("SMTP_MAX_CONNECTIONS", 10);
  const connectionTimeout = parsePositiveIntEnv("SMTP_CONNECTION_TIMEOUT_MS", 8_000);
  const greetingTimeout = parsePositiveIntEnv("SMTP_GREETING_TIMEOUT_MS", 8_000);
  const socketTimeout = parsePositiveIntEnv("SMTP_SOCKET_TIMEOUT_MS", 15_000);

  return nodemailer.createTransport({
    host: v.host,
    port: v.port,
    secure: usesImplicitTls,
    ...smtpAuthOptions(v.host, v.username, v.password),
    connectionTimeout,
    greetingTimeout,
    socketTimeout,
    ...smtpConnectionExtras(v.host, v.port),
    ...(egressUrl ? { getSocket: buildSmtpEgressGetSocket(egressUrl) } : {}),
    ...(poolEnabled
      ? {
          pool: true,
          maxConnections,
          maxMessages: parsePositiveIntEnv("SMTP_MAX_MESSAGES_PER_CONNECTION", 500),
        }
      : {}),
    ...(dkim ? { dkim } : {}),
  } as TransportOptions);
}
