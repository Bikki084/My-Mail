"use client";

import { useState } from "react";
import Link from "next/link";
import { ArrowLeft, Mail } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  authCardClass,
  authErrorClass,
  authFieldClass,
  authHeadingClass,
  authIconClass,
  authLabelClass,
  authSubmitClass,
  authSubtextClass,
} from "@/components/auth/auth-styles";
import { AuthPageShell } from "@/components/auth/auth-page-shell";
import {
  AUTH_EMAIL_MAX_LENGTH,
  clampToMaxLength,
} from "@/lib/auth/field-limits";

function isValidEmail(value: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim());
}

const SUCCESS_MESSAGE =
  "If this email exists in our system, a reset link has been sent.";

type ForgotPasswordJson = {
  ok?: boolean;
  error?: string;
  message?: string;
  devResetLink?: string;
};

export function ForgotPasswordForm() {
  const [email, setEmail] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const [devResetLink, setDevResetLink] = useState<string | null>(null);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!email.trim()) {
      setError("Email is required.");
      return;
    }
    if (!isValidEmail(email)) {
      setError("Enter a valid email address.");
      return;
    }
    if (email.trim().length > AUTH_EMAIL_MAX_LENGTH) {
      setError(`Email must be at most ${AUTH_EMAIL_MAX_LENGTH} characters.`);
      return;
    }
    setError(null);
    setLoading(true);
    setDevResetLink(null);

    try {
      const res = await fetch("/api/auth/admin-forgot-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: email.trim() }),
      });
      let data: ForgotPasswordJson = {};
      try {
        data = (await res.json()) as ForgotPasswordJson;
      } catch {
        setError("Something went wrong. Try again.");
        return;
      }
      if (!res.ok || data.ok === false) {
        setError(data.error ?? "We could not send a reset link. Try again.");
        return;
      }
      if (typeof data.devResetLink === "string" && data.devResetLink.length > 0) {
        setDevResetLink(data.devResetLink);
      }
      setDone(true);
    } catch {
      setError("Something went wrong. Check your connection and try again.");
    } finally {
      setLoading(false);
    }
  }

  if (done) {
    return (
      <AuthPageShell>
        <div className={authCardClass}>
          <div className="mb-8 flex justify-center">
            <div className={authIconClass}>
              <Mail className="size-[18px] text-white" strokeWidth={2} />
            </div>
          </div>
          <div className="mb-8 space-y-3 text-center">
            <h1 className={authHeadingClass}>Check your email</h1>
            <p className={`${authSubtextClass} max-w-[340px] mx-auto text-pretty`}>
              {SUCCESS_MESSAGE}
            </p>
            {devResetLink && (
              <div
                className="mt-6 rounded-lg border border-amber-500/40 bg-amber-500/10 px-4 py-3 text-left text-[13px] leading-[1.55] text-amber-100"
                role="region"
                aria-label="Development reset link"
              >
                <p className="font-medium text-amber-50">Development only — email was not sent</p>
                <p className="mt-2 text-amber-100/90">
                  SMTP for admin reset is not working or not configured. Use this link once (expires
                  in 10 minutes), then set{" "}
                  <code className="rounded bg-black/30 px-1 py-0.5 text-[12px]">
                    ADMIN_RESET_SMTP_*
                  </code>{" "}
                  in <code className="rounded bg-black/30 px-1 py-0.5 text-[12px]">.env.local</code>{" "}
                  and restart the server.
                </p>
                <a
                  href={devResetLink}
                  className="mt-3 block break-all font-mono text-[12px] text-emerald-300 underline decoration-emerald-400/50 hover:text-emerald-200"
                >
                  {devResetLink}
                </a>
              </div>
            )}
          </div>
          <Link
            href="/login"
            className="flex items-center justify-center gap-2 text-[14px] font-medium leading-[1.5] text-[#9CA3AF] transition-colors hover:text-gray-300"
          >
            <ArrowLeft className="size-4 shrink-0" />
            Back to sign in
          </Link>
        </div>
      </AuthPageShell>
    );
  }

  return (
    <AuthPageShell>
      <div className={authCardClass}>
        <div className="mb-8 flex justify-center">
          <div className={authIconClass}>
            <Mail className="size-[18px] text-white" strokeWidth={2} />
          </div>
        </div>
        <div className="mb-8 space-y-3 text-center">
          <h1 className={authHeadingClass}>Reset password</h1>
          <p className={`${authSubtextClass} max-w-[320px] mx-auto`}>
            Enter the admin account email you use to sign in to the dashboard, then send the reset
            link.
          </p>
        </div>
        <form onSubmit={onSubmit} className="space-y-6" noValidate>
          <div className="space-y-2">
            <Label htmlFor="reset-email" className={authLabelClass}>
              Email address
            </Label>
            <Input
              id="reset-email"
              type="email"
              autoComplete="email"
              maxLength={AUTH_EMAIL_MAX_LENGTH}
              value={email}
              onChange={(e) => {
                setEmail(clampToMaxLength(e.target.value, AUTH_EMAIL_MAX_LENGTH));
                setError(null);
              }}
              className={authFieldClass}
              placeholder="you@company.com"
            />
            {error && (
              <p className={authErrorClass} role="alert">
                {error}
              </p>
            )}
          </div>
          <button type="submit" disabled={loading} className={authSubmitClass}>
            {loading ? "Sending…" : "Send reset link"}
          </button>
        </form>
        <Link
          href="/login"
          className="mt-8 flex items-center justify-center gap-2 text-[14px] font-medium leading-[1.5] text-[#9CA3AF] transition-colors hover:text-gray-300"
        >
          <ArrowLeft className="size-4 shrink-0" />
          Back to sign in
        </Link>
      </div>
    </AuthPageShell>
  );
}
