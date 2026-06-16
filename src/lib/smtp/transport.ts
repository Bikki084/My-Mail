import nodemailer, { type Transporter, type TransportOptions } from "nodemailer";
import { getDkimConfigFromEnv } from "@/lib/deliverability";
import { parsePositiveIntEnv } from "@/lib/async-pool";

/** Loopback relays (e.g. Postfix on the same VPS as the app). */
export function isLocalSmtpHost(host: string): boolean {
  const h = host.trim().toLowerCase();
  return h === "localhost" || h === "127.0.0.1" || h === "::1";
}

/**
 * Local Postfix often advertises STARTTLS with a self-signed cert. On loopback port 25
 * we skip TLS entirely; otherwise accept self-signed for local submission ports.
 */
export function smtpConnectionExtras(
  host: string,
  port: number,
): Pick<TransportOptions, "tls" | "ignoreTLS"> {
  if (!isLocalSmtpHost(host)) return {};
  if (port === 25) return { ignoreTLS: true };
  return { tls: { rejectUnauthorized: false } };
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
}): Transporter {
  const usesImplicitTls = v.port === 465 ? true : v.port === 587 ? false : v.secure;
  const dkim = getDkimConfigFromEnv();
  const poolEnabled = process.env.SMTP_POOL !== "0";
  const maxConnections = parsePositiveIntEnv("SMTP_MAX_CONNECTIONS", 10);
  const connectionTimeout = parsePositiveIntEnv("SMTP_CONNECTION_TIMEOUT_MS", 8_000);
  const greetingTimeout = parsePositiveIntEnv("SMTP_GREETING_TIMEOUT_MS", 8_000);
  const socketTimeout = parsePositiveIntEnv("SMTP_SOCKET_TIMEOUT_MS", 15_000);

  return nodemailer.createTransport({
    host: v.host,
    port: v.port,
    secure: usesImplicitTls,
    auth: { user: v.username, pass: v.password },
    connectionTimeout,
    greetingTimeout,
    socketTimeout,
    ...smtpConnectionExtras(v.host, v.port),
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
