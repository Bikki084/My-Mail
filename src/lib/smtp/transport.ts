import nodemailer, { type Transporter, type TransportOptions } from "nodemailer";
import { getDkimConfigFromEnv } from "@/lib/deliverability";

/**
 * Nodemailer transport for user SMTP, matching server actions' host/port/secure rules
 * (Gmail/587 STARTTLS, 465 implicit TLS, etc.).
 *
 * If `DKIM_DOMAIN` / `DKIM_KEY_SELECTOR` / `DKIM_PRIVATE_KEY` env vars are set,
 * the transport DKIM-signs every outgoing message in-process. Public relays
 * (Gmail SMTP, SendGrid, SES, Brevo, Mailgun) already DKIM-sign at the relay,
 * so this is only needed for self-hosted SMTP or to add a second signature.
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
  return nodemailer.createTransport({
    host: v.host,
    port: v.port,
    secure: usesImplicitTls,
    auth: { user: v.username, pass: v.password },
    connectionTimeout: 15_000,
    greetingTimeout: 10_000,
    socketTimeout: 20_000,
    ...(dkim ? { dkim } : {}),
  } as TransportOptions);
}
