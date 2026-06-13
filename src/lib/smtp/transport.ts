import nodemailer, { type Transporter, type TransportOptions } from "nodemailer";
import { parsePositiveIntEnv } from "@/lib/async-pool";

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
    ...(poolEnabled
      ? {
          pool: true,
          maxConnections,
          maxMessages: parsePositiveIntEnv("SMTP_MAX_MESSAGES_PER_CONNECTION", 500),
        }
      : {}),
  } as TransportOptions);
}
