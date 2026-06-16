"use server";

import { revalidatePath } from "next/cache";
import nodemailer, { type TransportOptions } from "nodemailer";
import { createClient as createServerSupabase } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/admin";
import {
  encryptSmtpPassword,
  decryptSmtpPassword,
  isValidEncryptionKeyConfigured,
  SmtpSecretConfigError,
} from "@/lib/crypto/smtp-secret";
import {
  DUPLICATE_SMTP_MESSAGE,
  isUniqueViolation,
  smtpIdentityKey,
} from "@/lib/smtp-identity";
import { smtpAuthOptions, smtpConnectionExtras, resolveSmtpImplicitTls } from "@/lib/smtp/transport";

export type ActionResult<T = undefined> =
  | { ok: true; data?: T }
  | { ok: false; error: string };

/* --------------------------- shared validation --------------------------- */

export type SmtpProvider = "gmail" | "yahoo" | "outlook" | "custom";

export type SmtpFormInput = {
  host: string;
  port: number | string;
  secure: boolean;
  username: string;
  password: string;
  label?: string | null;
  provider?: SmtpProvider | null;
  /** Optional insert order for bulk rotation (lower = earlier in chunk send order). */
  rotationOrder?: number | null;
};

const HOST_RE = /^[a-z0-9.-]+\.[a-z]{2,}$/i;
const IP_V4 =
  /^(?:(?:25[0-5]|2[0-4]\d|[01]?\d{1,2})\.){3}(?:25[0-5]|2[0-4]\d|[01]?\d{1,2})$/;

function isValidSmtpHost(host: string): boolean {
  if (host === "localhost") return true;
  if (IP_V4.test(host)) return true;
  return HOST_RE.test(host);
}

type ValidatedSmtpInput = {
  host: string;
  port: number;
  secure: boolean;
  username: string;
  password: string;
  label: string | null;
  provider: SmtpProvider;
};

function validateSmtpInput(input: SmtpFormInput): ValidatedSmtpInput | string {
  const host = String(input.host ?? "").trim().toLowerCase();
  if (!host) return "Host is required.";
  if (!isValidSmtpHost(host)) {
    return "Host looks invalid (use e.g. smtp.gmail.com, localhost, or 127.0.0.1).";
  }

  const portNum =
    typeof input.port === "number" ? input.port : parseInt(String(input.port ?? ""), 10);
  if (!Number.isFinite(portNum) || portNum <= 0 || portNum > 65535) {
    return "Port must be a number between 1 and 65535.";
  }

  const username = String(input.username ?? "").trim();
  if (!username) return "Username is required.";
  if (username.length > 320) return "Username is too long.";

  // Gmail App Passwords are displayed with spaces ("abcd efgh ijkl mnop") but
  // the real credential is the 16 char blob without spaces. Strip to be safe —
  // Google documents either form as acceptable.
  const password = String(input.password ?? "").replace(/\s+/g, "");
  if (!password) return "Password is required.";
  if (password.length > 512) return "Password is unexpectedly long.";

  const label = input.label ? String(input.label).trim().slice(0, 80) : null;

  const provider: SmtpProvider =
    input.provider && ["gmail", "yahoo", "outlook", "custom"].includes(input.provider)
      ? input.provider
      : "custom";

  return {
    host,
    port: portNum,
    secure: Boolean(input.secure),
    username,
    password,
    label: label && label.length > 0 ? label : null,
    provider,
  };
}

function buildTransportOptions(v: ValidatedSmtpInput): TransportOptions {
  const usesImplicitTls = resolveSmtpImplicitTls(v.host, v.port, v.secure);
  return {
    host: v.host,
    port: v.port,
    secure: usesImplicitTls,
    ...smtpAuthOptions(v.host, v.username, v.password),
    // Fail fast — no point waiting 60s on a bad host/port combo.
    connectionTimeout: 15_000,
    greetingTimeout: 10_000,
    socketTimeout: 20_000,
    ...smtpConnectionExtras(v.host, v.port),
  } as TransportOptions;
}

function friendlySmtpError(err: unknown, hostHint?: string): string {
  if (err instanceof SmtpSecretConfigError) return err.message;
  const e = err as { code?: string; responseCode?: number; response?: string; message?: string };
  const code = e.code ?? "";
  const resp = e.response ?? "";
  const msg = e.message ?? "Unknown SMTP error.";
  const host =
    hostHint?.trim() ||
    (typeof (e as { address?: string }).address === "string"
      ? (e as { address?: string }).address
      : "") ||
    "the SMTP host";

  if (code === "EAUTH" || /535|534/.test(resp)) {
    return (
      "Authentication failed. For Gmail/Yahoo/Outlook you must use an App Password (not your " +
      "regular account password), and 2-Step Verification must be enabled on the account. " +
      `Server said: ${resp || msg}`
    );
  }
  if (code === "ETIMEDOUT" || code === "ESOCKET") {
    const localHint =
      host === "127.0.0.1" || host === "localhost"
        ? " For 127.0.0.1:25, install and start Postfix on this server (sudo systemctl status postfix)."
        : "";
    return `Could not reach ${host} — connection timed out. Check host, port, and that outbound SMTP isn't blocked (${msg}).${localHint}`;
  }
  if (code === "ECONNECTION" || code === "ECONNREFUSED") {
    const localHint =
      host === "127.0.0.1" || host === "localhost"
        ? " Nothing is listening on port 25 — run: sudo apt install postfix && sudo systemctl start postfix"
        : "";
    return `Connection refused by ${host} (${msg}). Double-check host/port.${localHint}`;
  }
  if (code === "EDNS") {
    return `DNS lookup failed for the host (${msg}).`;
  }
  if (/self-signed certificate/i.test(msg)) {
    return `TLS certificate rejected (${msg}). For local Postfix on 127.0.0.1:25, turn Secure OFF — port 25 is plain SMTP.`;
  }
  if (/wrong version number/i.test(msg)) {
    return `TLS mismatch on ${host}: turn Secure (TLS) OFF for port 25 / local Postfix (127.0.0.1). Port 25 does not use implicit TLS.`;
  }
  return msg;
}

/* --------------------------------- guard --------------------------------- */

async function requireClientUser(): Promise<
  { ok: true; userId: string; email: string | null } | { ok: false; error: string }
> {
  const supabase = await createServerSupabase();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: "Not authenticated." };

  const { data: profile } = await supabase
    .from("profiles")
    .select("role")
    .eq("id", user.id)
    .maybeSingle();
  if (!profile) return { ok: false, error: "Profile missing." };
  if (profile.role !== "client" && profile.role !== "admin") {
    return { ok: false, error: "Not authorised." };
  }
  return { ok: true, userId: user.id, email: user.email ?? null };
}

/* ---------------------------------- API ---------------------------------- */

export type SmtpTestResult = {
  verified: boolean;
  /** Human-readable provider greeting (e.g. "smtp.gmail.com ESMTP"), if captured. */
  banner?: string;
};

/**
 * Runs a Nodemailer `verify()` against the provided credentials. No email is
 * sent. Used by the "Test SMTP" button in the UI.
 */
export async function testSmtpConnection(
  input: SmtpFormInput,
): Promise<ActionResult<SmtpTestResult>> {
  const guard = await requireClientUser();
  if (!guard.ok) return guard;

  const v = validateSmtpInput(input);
  if (typeof v === "string") return { ok: false, error: v };

  try {
    const transporter = nodemailer.createTransport(buildTransportOptions(v));
    await transporter.verify();
    transporter.close();
    return { ok: true, data: { verified: true } };
  } catch (err) {
    return { ok: false, error: friendlySmtpError(err, v.host) };
  }
}

export type SendTestEmailInput = SmtpFormInput & {
  /** Address to deliver the test email to. Defaults to the logged-in user's own email. */
  to?: string;
};

/**
 * Actually sends a single test email from the provided SMTP to the chosen
 * recipient (default: the authenticated user's own email address). Returns the
 * message id reported by the SMTP server on success.
 */
export async function sendSmtpTestEmail(
  input: SendTestEmailInput,
): Promise<ActionResult<{ messageId: string; accepted: string[] }>> {
  const guard = await requireClientUser();
  if (!guard.ok) return guard;

  const v = validateSmtpInput(input);
  if (typeof v === "string") return { ok: false, error: v };

  const to = (input.to ?? guard.email ?? "").trim();
  if (!to) {
    return {
      ok: false,
      error:
        "No recipient address available — your profile email is empty. Provide a 'to' address.",
    };
  }

  try {
    const transporter = nodemailer.createTransport(buildTransportOptions(v));
    const info = await transporter.sendMail({
      from: `"MyMail Test" <${v.username}>`,
      to,
      subject: "MyMail SMTP test",
      text:
        `This is a test email sent from the MyMail SaaS SMTP configuration page.\n\n` +
        `Host: ${v.host}\nPort: ${v.port}\nUsername: ${v.username}\n\n` +
        `If you received this, your SMTP is working. You can now use it to send campaigns.`,
    });
    transporter.close();
    return {
      ok: true,
      data: {
        messageId: info.messageId ?? "",
        accepted: (info.accepted ?? []).map((a) => String(a)),
      },
    };
  } catch (err) {
    return { ok: false, error: friendlySmtpError(err, v.host) };
  }
}

export type SavedSmtpRow = {
  id: string;
  label: string | null;
  provider: string | null;
  host: string;
  port: number;
  username: string;
  secure: boolean;
  created_at: string;
};

function toSavedRow(row: Record<string, unknown>): SavedSmtpRow {
  return {
    id: String(row.id),
    label: (row.label as string | null) ?? null,
    provider: (row.provider as string | null) ?? null,
    host: String(row.host),
    port: Number(row.port),
    username: String(row.username),
    secure: Boolean(row.secure),
    created_at: String(row.created_at ?? new Date().toISOString()),
  };
}

/**
 * Encrypts the password with AES-256-GCM using SMTP_ENCRYPTION_KEY and inserts
 * (or updates, if an id is provided) a row in public.smtp_servers for the
 * authenticated user.
 */
export async function saveSmtpServer(
  input: SmtpFormInput & { id?: string | null },
): Promise<ActionResult<SavedSmtpRow>> {
  const guard = await requireClientUser();
  if (!guard.ok) return guard;

  if (!isValidEncryptionKeyConfigured()) {
    return {
      ok: false,
      error:
        "SMTP_ENCRYPTION_KEY is not configured on the server. Add a 32-byte key to .env.local " +
        "(e.g. `SMTP_ENCRYPTION_KEY=$(openssl rand -base64 32)`) and restart the dev server.",
    };
  }

  const v = validateSmtpInput(input);
  if (typeof v === "string") return { ok: false, error: v };

  let password_enc: string;
  try {
    password_enc = encryptSmtpPassword(v.password);
  } catch (err) {
    return { ok: false, error: friendlySmtpError(err) };
  }

  const supabase = await createServerSupabase();
  const payload: Record<string, unknown> = {
    user_id: guard.userId,
    label: v.label ?? `${v.provider} — ${v.username}`,
    provider: v.provider,
    host: v.host,
    port: v.port,
    username: v.username,
    password_enc,
    secure: v.secure,
  };
  if (input.rotationOrder != null && Number.isFinite(Number(input.rotationOrder))) {
    payload.rotation_order = Math.max(0, Math.floor(Number(input.rotationOrder)));
  }

  try {
    if (input.id) {
      const { data, error } = await supabase
        .from("smtp_servers")
        .update(payload)
        .eq("id", input.id)
        .eq("user_id", guard.userId)
        .select("id, label, provider, host, port, username, secure, created_at")
        .single();
      if (error) return { ok: false, error: error.message };
      revalidatePath("/client");
      revalidatePath("/client/smtp");
      return { ok: true, data: toSavedRow(data as Record<string, unknown>) };
    }

    const { data: existing } = await supabase
      .from("smtp_servers")
      .select("id")
      .eq("user_id", guard.userId)
      .eq("host", v.host)
      .eq("port", v.port)
      .ilike("username", v.username)
      .maybeSingle();
    if (existing) {
      return { ok: false, error: DUPLICATE_SMTP_MESSAGE };
    }

    const { data, error } = await supabase
      .from("smtp_servers")
      .insert(payload)
      .select("id, label, provider, host, port, username, secure, created_at")
      .single();
    if (error) {
      if (isUniqueViolation(error as { code?: string })) {
        return { ok: false, error: DUPLICATE_SMTP_MESSAGE };
      }
      return { ok: false, error: error.message };
    }
    revalidatePath("/client");
    revalidatePath("/client/smtp");
    return { ok: true, data: toSavedRow(data as Record<string, unknown>) };
  } catch (err) {
    return { ok: false, error: friendlySmtpError(err) };
  }
}

/** Returns the authenticated user's saved SMTP rows (newest first, no secrets). */
export async function listSmtpServers(): Promise<ActionResult<SavedSmtpRow[]>> {
  const guard = await requireClientUser();
  if (!guard.ok) return guard;

  const supabase = await createServerSupabase();
  const { data, error } = await supabase
    .from("smtp_servers")
    .select("id, label, provider, host, port, username, secure, created_at")
    .eq("user_id", guard.userId)
    .order("created_at", { ascending: false });
  if (error) return { ok: false, error: error.message };
  return { ok: true, data: (data ?? []).map((r) => toSavedRow(r as Record<string, unknown>)) };
}

const MAX_BULK_SMTP_IMPORT = 500;

/**
 * Inserts many SMTP rows in file order (`rotation_order` appended after any
 * existing max for this user). Re-validates and encrypts each row server-side.
 */
export async function importBulkSmtpServers(
  inputs: SmtpFormInput[],
): Promise<
  ActionResult<{
    imported: number;
    failed: { index: number; error: string }[];
    skippedDuplicates: { index: number; reason: string }[];
    /** Row ids inserted in file order (for composer rotation scope). */
    insertedIds: string[];
  }>
> {
  const guard = await requireClientUser();
  if (!guard.ok) return guard;

  if (!isValidEncryptionKeyConfigured()) {
    return {
      ok: false,
      error:
        "SMTP_ENCRYPTION_KEY is not configured on the server. Add a 32-byte key to .env.local " +
        "(e.g. `SMTP_ENCRYPTION_KEY=$(openssl rand -base64 32)`) and restart the dev server.",
    };
  }

  if (!inputs.length) {
    return { ok: false, error: "No SMTP rows to import." };
  }
  if (inputs.length > MAX_BULK_SMTP_IMPORT) {
    return {
      ok: false,
      error: `Too many rows at once (max ${MAX_BULK_SMTP_IMPORT}). Split into multiple files.`,
    };
  }

  const supabase = await createServerSupabase();

  const { data: existingRows } = await supabase
    .from("smtp_servers")
    .select("host, port, username")
    .eq("user_id", guard.userId);
  const existingKeys = new Set(
    (existingRows ?? []).map((r) =>
      smtpIdentityKey(
        String(r.host),
        Number(r.port),
        String(r.username),
      ),
    ),
  );

  const { data: ordRow } = await supabase
    .from("smtp_servers")
    .select("rotation_order")
    .eq("user_id", guard.userId)
    .order("rotation_order", { ascending: false })
    .limit(1)
    .maybeSingle();

  let nextOrder =
    ordRow && typeof ordRow.rotation_order === "number" && Number.isFinite(ordRow.rotation_order)
      ? Math.max(0, ordRow.rotation_order) + 1
      : 0;

  const seenInFile = new Set<string>();
  const failed: { index: number; error: string }[] = [];
  const skippedDuplicates: { index: number; reason: string }[] = [];
  let imported = 0;
  const insertedIds: string[] = [];

  for (let i = 0; i < inputs.length; i++) {
    const raw = inputs[i];
    const v = validateSmtpInput(raw);
    if (typeof v === "string") {
      failed.push({ index: i, error: v });
      continue;
    }

    const identityKey = smtpIdentityKey(v.host, v.port, v.username);
    if (seenInFile.has(identityKey)) {
      skippedDuplicates.push({
        index: i,
        reason: "Duplicate line in this import file.",
      });
      continue;
    }
    seenInFile.add(identityKey);

    if (existingKeys.has(identityKey)) {
      skippedDuplicates.push({
        index: i,
        reason: DUPLICATE_SMTP_MESSAGE,
      });
      continue;
    }

    let password_enc: string;
    try {
      password_enc = encryptSmtpPassword(v.password);
    } catch (err) {
      failed.push({ index: i, error: friendlySmtpError(err) });
      continue;
    }

    const payload = {
      user_id: guard.userId,
      label: v.label ?? `${v.provider} — ${v.username}`,
      provider: v.provider,
      host: v.host,
      port: v.port,
      username: v.username,
      password_enc,
      secure: v.secure,
      rotation_order: nextOrder++,
    };

    const { data: insRow, error } = await supabase
      .from("smtp_servers")
      .insert(payload)
      .select("id")
      .single();
    if (error) {
      if (isUniqueViolation(error as { code?: string })) {
        skippedDuplicates.push({
          index: i,
          reason: DUPLICATE_SMTP_MESSAGE,
        });
        existingKeys.add(identityKey);
      } else {
        failed.push({ index: i, error: error.message });
      }
      continue;
    }
    if (insRow?.id && typeof insRow.id === "string") {
      insertedIds.push(insRow.id);
    }
    existingKeys.add(identityKey);
    imported += 1;
  }

  revalidatePath("/client");
  revalidatePath("/client/smtp");
  return { ok: true, data: { imported, failed, skippedDuplicates, insertedIds } };
}

export async function deleteSmtpServer(id: string): Promise<ActionResult> {
  const guard = await requireClientUser();
  if (!guard.ok) return guard;
  if (!id) return { ok: false, error: "Missing id." };

  const supabase = await createServerSupabase();
  const { error } = await supabase
    .from("smtp_servers")
    .delete()
    .eq("id", id)
    .eq("user_id", guard.userId);
  if (error) return { ok: false, error: error.message };
  revalidatePath("/client");
  revalidatePath("/client/smtp");
  return { ok: true };
}

/**
 * Verify + send a test email using a *saved* SMTP (by id). The worker / send
 * pipeline would use a similar path: look up the row with the service client,
 * decrypt the password, build a transporter. This is exported so the UI can
 * "Send test email" against a saved row without the user re-typing credentials.
 */
export async function sendTestEmailFromSaved(input: {
  id: string;
  to?: string;
}): Promise<ActionResult<{ messageId: string; accepted: string[] }>> {
  const guard = await requireClientUser();
  if (!guard.ok) return guard;
  if (!input.id) return { ok: false, error: "Missing SMTP id." };

  // Use the service client so we can read password_enc regardless of RLS —
  // we've already authenticated the caller and scope the lookup by user_id.
  let service;
  try {
    service = createServiceClient();
  } catch {
    return {
      ok: false,
      error:
        "Server is missing SUPABASE_SERVICE_ROLE_KEY — cannot read the stored SMTP row. Add it " +
        "to .env.local (Supabase → Settings → API → service_role).",
    };
  }

  const { data: row, error } = await service
    .from("smtp_servers")
    .select("host, port, secure, username, password_enc")
    .eq("id", input.id)
    .eq("user_id", guard.userId)
    .maybeSingle();
  if (error) return { ok: false, error: error.message };
  if (!row) return { ok: false, error: "SMTP row not found." };

  let password: string;
  try {
    password = decryptSmtpPassword(String(row.password_enc));
  } catch (err) {
    return { ok: false, error: friendlySmtpError(err) };
  }

  return sendSmtpTestEmail({
    host: String(row.host),
    port: Number(row.port),
    secure: Boolean(row.secure),
    username: String(row.username),
    password,
    to: input.to,
  });
}
