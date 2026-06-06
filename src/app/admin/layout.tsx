import { redirect } from "next/navigation";
import { AdminShell } from "@/components/admin/admin-shell";
import { isSupabaseAuthConfigured } from "@/lib/auth-config";
import { createClient } from "@/lib/supabase/server";

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  if (!isSupabaseAuthConfigured()) {
    redirect("/login?next=/admin&auth=required");
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    redirect("/login?next=/admin");
  }

  const { data: profile } = await supabase
    .from("profiles")
    .select("role, full_name, email")
    .eq("id", user.id)
    .maybeSingle();

  const role =
    profile?.role ?? ((user.user_metadata as { role?: string } | null)?.role ?? null);

  if (role !== "admin") {
    redirect(role === "client" ? "/client" : "/login");
  }

  const userLabel =
    (profile?.full_name && profile.full_name.trim()) ||
    profile?.email ||
    user.email ||
    "Admin User";

  return (
    <div className="min-h-svh bg-black font-sans antialiased">
      <AdminShell userLabel={userLabel}>{children}</AdminShell>
    </div>
  );
}
