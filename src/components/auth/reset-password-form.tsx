"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Eye, EyeOff, Mail } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
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

const INVALID_MESSAGE = "Link expired or invalid";

/** Remount when `token` query changes so verification state resets without sync effects. */
export function ResetPasswordFormWithKey() {
  const searchParams = useSearchParams();
  const tokenKey = searchParams.get("token")?.trim() ?? "";
  return <ResetPasswordForm key={tokenKey} />;
}

export function ResetPasswordForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const token = searchParams.get("token")?.trim() ?? "";

  /** `null` = verification in flight; `true` / `false` = result. */
  const [verify, setVerify] = useState<boolean | null>(null);
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);
  const [loading, setLoading] = useState(false);
  const [errors, setErrors] = useState<{ password?: string; confirm?: string }>({});

  useEffect(() => {
    if (!token) return;

    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(
          `/api/auth/admin-reset-password/verify?token=${encodeURIComponent(token)}`,
          { method: "GET" },
        );
        const data = (await res.json()) as { valid?: boolean };
        if (!cancelled) setVerify(data.valid === true);
      } catch {
        if (!cancelled) setVerify(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [token]);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    const next: { password?: string; confirm?: string } = {};
    if (!password) next.password = "Password is required.";
    else if (password.length < 6) next.password = "Use at least 6 characters.";
    if (password !== confirm) next.confirm = "Passwords do not match.";
    setErrors(next);
    if (Object.keys(next).length > 0) return;

    setLoading(true);
    try {
      const res = await fetch("/api/auth/admin-reset-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token, password, confirmPassword: confirm }),
      });
      const data = (await res.json()) as { ok?: boolean; error?: string };

      if (!res.ok || !data.ok) {
        toast.error(data.error ?? INVALID_MESSAGE);
        setLoading(false);
        return;
      }

      router.push("/login?reset=success");
      router.refresh();
    } catch {
      toast.error("Something went wrong. Try again.");
    } finally {
      setLoading(false);
    }
  }

  if (!token) {
    return (
      <div className={authPageClass}>
        <div className={`relative ${authCardClass}`}>
          <div className="mb-8 flex justify-center">
            <div className="flex size-9 items-center justify-center rounded-lg bg-gradient-to-br from-indigo-500 to-violet-600 shadow-lg shadow-indigo-500/15">
              <Mail className="size-[18px] text-white" strokeWidth={2} />
            </div>
          </div>
          <div className="mb-8 space-y-3 text-center">
            <h1 className={authHeadingClass}>Reset unavailable</h1>
            <p className={`${authSubtextClass} max-w-[320px] mx-auto`}>{INVALID_MESSAGE}</p>
          </div>
          <Link href="/login" className={`flex justify-center ${authFooterLinkClass}`}>
            Back to sign in
          </Link>
        </div>
      </div>
    );
  }

  if (verify === null) {
    return (
      <div className={authPageClass}>
        <div className={`relative ${authCardClass}`}>
          <p className="text-center text-[14px] text-[#9CA3AF]">Verifying link…</p>
        </div>
      </div>
    );
  }

  if (!verify) {
    return (
      <div className={authPageClass}>
        <div className={`relative ${authCardClass}`}>
          <div className="mb-8 flex justify-center">
            <div className="flex size-9 items-center justify-center rounded-lg bg-gradient-to-br from-indigo-500 to-violet-600 shadow-lg shadow-indigo-500/15">
              <Mail className="size-[18px] text-white" strokeWidth={2} />
            </div>
          </div>
          <div className="mb-8 space-y-3 text-center">
            <h1 className={authHeadingClass}>Reset unavailable</h1>
            <p className={`${authSubtextClass} max-w-[320px] mx-auto`}>{INVALID_MESSAGE}</p>
          </div>
          <Link href="/login" className={`flex justify-center ${authFooterLinkClass}`}>
            Back to sign in
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className={authPageClass}>
      <div className={`relative ${authCardClass}`}>
        <div className="mb-8 flex justify-center">
          <div className="flex size-9 items-center justify-center rounded-lg bg-gradient-to-br from-indigo-500 to-violet-600 shadow-lg shadow-indigo-500/15">
            <Mail className="size-[18px] text-white" strokeWidth={2} />
          </div>
        </div>
        <div className="mb-8 space-y-3 text-center">
          <h1 className={authHeadingClass}>Set new password</h1>
          <p className={authSubtextClass}>Choose a new password for the admin account.</p>
        </div>

        <form onSubmit={onSubmit} className="space-y-6" noValidate>
          <div className="space-y-2">
            <Label htmlFor="reset-pass" className={authLabelClass}>
              New password
            </Label>
            <div className="relative">
              <Input
                id="reset-pass"
                type={showPassword ? "text" : "password"}
                autoComplete="new-password"
                value={password}
                onChange={(e) => {
                  setPassword(e.target.value);
                  setErrors((s) => ({ ...s, password: undefined }));
                }}
                className={`${authFieldClass} pr-[40px]`}
              />
              <button
                type="button"
                className="absolute right-2 top-1/2 flex size-9 -translate-y-1/2 cursor-pointer items-center justify-center rounded-md text-[#9CA3AF] transition-colors hover:text-[#D1D5DB] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500/40"
                onClick={() => setShowPassword((v) => !v)}
                aria-label={showPassword ? "Hide password" : "Show password"}
              >
                {showPassword ? (
                  <Eye className="size-[18px] shrink-0" strokeWidth={2} aria-hidden />
                ) : (
                  <EyeOff className="size-[18px] shrink-0" strokeWidth={2} aria-hidden />
                )}
              </button>
            </div>
            {errors.password && (
              <p className={authErrorClass} role="alert">
                {errors.password}
              </p>
            )}
          </div>

          <div className="space-y-2">
            <Label htmlFor="reset-confirm" className={authLabelClass}>
              Confirm password
            </Label>
            <div className="relative">
              <Input
                id="reset-confirm"
                type={showConfirm ? "text" : "password"}
                autoComplete="new-password"
                value={confirm}
                onChange={(e) => {
                  setConfirm(e.target.value);
                  setErrors((s) => ({ ...s, confirm: undefined }));
                }}
                className={`${authFieldClass} pr-[40px]`}
              />
              <button
                type="button"
                className="absolute right-2 top-1/2 flex size-9 -translate-y-1/2 cursor-pointer items-center justify-center rounded-md text-[#9CA3AF] transition-colors hover:text-[#D1D5DB] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500/40"
                onClick={() => setShowConfirm((v) => !v)}
                aria-label={showConfirm ? "Hide confirm password" : "Show confirm password"}
              >
                {showConfirm ? (
                  <Eye className="size-[18px] shrink-0" strokeWidth={2} aria-hidden />
                ) : (
                  <EyeOff className="size-[18px] shrink-0" strokeWidth={2} aria-hidden />
                )}
              </button>
            </div>
            {errors.confirm && (
              <p className={authErrorClass} role="alert">
                {errors.confirm}
              </p>
            )}
          </div>

          <button type="submit" disabled={loading} className={authSubmitClass}>
            {loading ? "Updating…" : "Update password"}
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
