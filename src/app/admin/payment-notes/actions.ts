"use server";

import { createClient as createServerSupabase } from "@/lib/supabase/server";

export type ActionResult<T = undefined> =
  | { ok: true; data?: T }
  | { ok: false; error: string };

async function assertAdmin(): Promise<ActionResult> {
  const supabase = await createServerSupabase();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: "Not authenticated." };

  const { data: profile, error } = await supabase
    .from("profiles")
    .select("role")
    .eq("id", user.id)
    .maybeSingle();
  if (error) return { ok: false, error: error.message };
  if (profile?.role !== "admin") return { ok: false, error: "Admin role required." };
  return { ok: true };
}

export type PaymentNoteListItem = {
  id: string;
  userId: string;
  userLabel: string;
  amountDisplay: string;
  modeDisplay: string;
  dateDisplay: string;
  createdAt: string;
};

type TxRow = {
  id: string;
  user_id: string;
  payment_amount: number | null;
  payment_mode: string | null;
  payment_date: string | null;
  created_at: string;
};

function isPaymentNoteRow(row: TxRow): boolean {
  return (
    row.payment_amount != null ||
    (row.payment_mode != null && row.payment_mode.trim() !== "") ||
    row.payment_date != null
  );
}

function formatInr(amount: number | null): string {
  if (amount == null || Number.isNaN(Number(amount))) return "—";
  try {
    return new Intl.NumberFormat("en-IN", {
      style: "currency",
      currency: "INR",
      maximumFractionDigits: 0,
    }).format(Number(amount));
  } catch {
    return `₹${amount}`;
  }
}

function formatDate(isoDate: string | null, createdAt: string): string {
  const raw = isoDate ?? createdAt.slice(0, 10);
  const d = new Date(raw.includes("T") ? raw : `${raw}T12:00:00`);
  if (Number.isNaN(d.getTime())) return raw;
  return d.toLocaleDateString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

function profileLabel(p: { full_name: string | null; email: string } | undefined): string {
  if (!p) return "Unknown User";
  const name = p.full_name?.trim();
  if (name) return `${name} — ${p.email}`;
  return p.email || "Unknown User";
}

/**
 * Payment notes = `credit_transactions` rows with at least one payment field set
 * (offline payment logged when assigning / topping up credits).
 */
export async function listPaymentNotes(): Promise<ActionResult<PaymentNoteListItem[]>> {
  const guard = await assertAdmin();
  if (!guard.ok) return guard;

  const supabase = await createServerSupabase();

  const { data: raw, error } = await supabase
    .from("credit_transactions")
    .select("id, user_id, payment_amount, payment_mode, payment_date, created_at")
    .order("created_at", { ascending: false });

  if (error) return { ok: false, error: error.message };

  const txs = (raw ?? []).filter(isPaymentNoteRow) as TxRow[];
  if (txs.length === 0) return { ok: true, data: [] };

  const ids = [...new Set(txs.map((t) => t.user_id))];
  const { data: profs, error: pErr } = await supabase
    .from("profiles")
    .select("id, full_name, email")
    .in("id", ids);

  if (pErr) return { ok: false, error: pErr.message };

  const byId = new Map((profs ?? []).map((p) => [p.id, p]));

  const items: PaymentNoteListItem[] = txs.map((t) => {
    const p = byId.get(t.user_id);
    return {
      id: t.id,
      userId: t.user_id,
      userLabel: profileLabel(p),
      amountDisplay: formatInr(t.payment_amount),
      modeDisplay: t.payment_mode?.trim() || "—",
      dateDisplay: formatDate(t.payment_date, t.created_at),
      createdAt: t.created_at,
    };
  });

  return { ok: true, data: items };
}
