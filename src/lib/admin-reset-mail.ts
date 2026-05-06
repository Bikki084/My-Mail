import nodemailer, { type Transporter, type TransportOptions } from "nodemailer";
import { buildSmtpUserTransport } from "@/lib/smtp/transport";

function envTrim(key: string): string | undefined {
  const raw = process.env[key];
  if (raw == null) return undefined;
  return raw.replace(/\r/g, "").trim();
}

/**
 * Build a transporter for admin reset mail. Gmail uses Nodemailer's built-in
 * `service: "gmail"` preset (more reliable than raw smtp.gmail.com:587 on some
 * Windows / STARTTLS setups). Other hosts use the same transport as campaign SMTP.
 */
function buildAdminResetTransporter(): Transporter | null {
  const hostRaw = envTrim("ADMIN_RESET_SMTP_HOST");
  const user = envTrim("ADMIN_RESET_SMTP_USER");
  let pass = envTrim("ADMIN_RESET_SMTP_PASS");
  const portRaw = envTrim("ADMIN_RESET_SMTP_PORT") ?? "587";
  const port = parseInt(portRaw, 10);
  const secureEnv = envTrim("ADMIN_RESET_SMTP_SECURE")?.toLowerCase();
  const secure = secureEnv === "1" || secureEnv === "true" || secureEnv === "yes";

  const hostLc = hostRaw?.toLowerCase() ?? "";
  const useGmailPreset =
    !hostRaw || hostLc === "smtp.gmail.com" || hostLc === "gmail";

  if (useGmailPreset && pass) {
    pass = pass.replace(/\s+/g, "");
  }

  if (!user || !pass) {
    return null;
  }

  if (useGmailPreset) {
    return nodemailer.createTransport({
      service: "gmail",
      auth: { user, pass },
      connectionTimeout: 30_000,
      greetingTimeout: 20_000,
      socketTimeout: 30_000,
      // Some networks break IPv6 routes to Google SMTP; prefer IPv4 when needed.
      ...(envTrim("ADMIN_RESET_SMTP_IPV4") === "1"
        ? { family: 4 as const }
        : {}),
      ...(process.env.NODE_ENV === "development" &&
      envTrim("ADMIN_RESET_SMTP_DEBUG") === "1"
        ? { logger: console, debug: true }
        : {}),
    } as TransportOptions);
  }

  if (!Number.isFinite(port) || port <= 0) {
    return null;
  }

  return buildSmtpUserTransport({
    host: hostRaw!,
    port,
    secure,
    username: user,
    password: pass,
  });
}

export type SendAdminResetEmailArgs = {
  to: string;
  resetUrl: string;
};

export async function sendAdminPasswordResetEmail(
  args: SendAdminResetEmailArgs,
): Promise<void> {
  const transporter = buildAdminResetTransporter();
  if (!transporter) {
    throw new Error(
      "Admin reset SMTP is not configured. Set ADMIN_RESET_SMTP_USER, ADMIN_RESET_SMTP_PASS " +
        "(and for non-Gmail hosts ADMIN_RESET_SMTP_HOST). See .env.example.",
    );
  }

  const from =
    envTrim("ADMIN_RESET_MAIL_FROM") || `MyMail Admin <${args.to}>`;

  try {
    await transporter.sendMail({
      from,
      to: args.to,
      subject: "Reset Your Admin Password",
      text:
        `Hi Admin,\n\n` +
        `Click the link below to reset your password:\n\n` +
        `${args.resetUrl}\n\n` +
        `This link will expire in 10 minutes.\n\n` +
        `If you did not request this, ignore this email.\n`,
    });
  } finally {
    transporter.close();
  }
}
