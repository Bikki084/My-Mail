"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Mail } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { isSupabaseAuthConfigured } from "@/lib/auth-config";
import {
  authCardClass,
  authErrorClass,
  authFieldClass,
  authFooterLinkClass,
  authHeadingClass,
  authLabelClass,
  authPageClass,
  authSubmitClass,
  authSubtextClass,
} from "@/components/auth/auth-styles";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";

/**
 * Set new password after Supabase sends a recovery link to redirectTo (this route).
 */
export default function UpdatePasswordPage() {
  const router = useRouter();
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [loading, setLoading] = useState(false);
  const [errors, setErrors] = useState<{ password?: string; confirm?: string }>({});
  const [recoveryReady, setRecoveryReady] = useState(false);

  useEffect(() => {
    if (!isSupabaseAuthConfigured()) return;
    const supabase = createClient();
    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((event) => {
      if (event === "PASSWORD_RECOVERY") {
        setRecoveryReady(true);
      }
    });
    supabase.auth.getSession().then(({ data: { session } }) => {
      if (session) setRecoveryReady(true);
    });
    return () => subscription.unsubscribe();
  }, []);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    const next: { password?: string; confirm?: string } = {};
    if (!password) next.password = "Password is required.";
    else if (password.length < 6) next.password = "Use at least 6 characters.";
    if (password !== confirm) next.confirm = "Passwords do not match.";
    setErrors(next);
    if (Object.keys(next).length) return;

    if (!isSupabaseAuthConfigured()) {
      toast.error("Authentication is not configured.");
      return;
    }

    setLoading(true);
    const supabase = createClient();
    const { error } = await supabase.auth.updateUser({ password });
    setLoading(false);
    if (error) {
      toast.error(error.message);
      return;
    }
    toast.success("Password updated.");
    router.push("/login");
    router.refresh();
  }

  return (
    <div className={authPageClass}>
      <div className={`relative ${authCardClass}`}>
        <div className="mb-8 flex justify-center">
          <div className="flex size-9 items-center justify-center rounded-lg bg-gradient-to-br from-indigo-500 to-violet-600">
            <Mail className="size-[18px] text-white" strokeWidth={2} />
          </div>
        </div>
        <div className="mb-8 space-y-3 text-center">
          <h1 className={authHeadingClass}>Set new password</h1>
          <p className={authSubtextClass}>Choose a new password for your account.</p>
        </div>
        {!recoveryReady && (
          <p className="mb-6 text-center text-[14px] font-normal leading-[1.55] text-[#9CA3AF]">
            Use the reset link from your email to enable password change.
          </p>
        )}
        <form onSubmit={onSubmit} className="space-y-6" noValidate>
          <div className="space-y-2">
            <Label htmlFor="new-pass" className={authLabelClass}>
              New password
            </Label>
            <Input
              id="new-pass"
              type="password"
              autoComplete="new-password"
              value={password}
              onChange={(e) => {
                setPassword(e.target.value);
                setErrors((s) => ({ ...s, password: undefined }));
              }}
              className={authFieldClass}
            />
            {errors.password && <p className={authErrorClass}>{errors.password}</p>}
          </div>
          <div className="space-y-2">
            <Label htmlFor="confirm-pass" className={authLabelClass}>
              Confirm password
            </Label>
            <Input
              id="confirm-pass"
              type="password"
              autoComplete="new-password"
              value={confirm}
              onChange={(e) => {
                setConfirm(e.target.value);
                setErrors((s) => ({ ...s, confirm: undefined }));
              }}
              className={authFieldClass}
            />
            {errors.confirm && <p className={authErrorClass}>{errors.confirm}</p>}
          </div>
          <button type="submit" disabled={loading || !recoveryReady} className={authSubmitClass}>
            {loading ? "Saving…" : "Update password"}
          </button>
        </form>
        <p className="mt-8 text-center">
          <Link href="/login" className={authFooterLinkClass}>
            Back to sign in
          </Link>
        </p>
      </div>
    </div>
  );
}
