"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Eye, EyeOff, Mail } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { isSupabaseAuthConfigured } from "@/lib/auth-config";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import {
  authCardClass,
  authErrorClass,
  authFieldClass,
  authFooterLinkClass,
  authForgotLinkClass,
  authHeadingClass,
  authLabelClass,
  authPageClass,
  authSubmitClass,
  authSubtextClass,
} from "@/components/auth/auth-styles";

function isValidEmail(value: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim());
}

type FormError = { title: string; description?: string };

function friendlyAuthError(message: string): FormError {
  const m = message.toLowerCase();
  if (m.includes("invalid login credentials")) {
    return {
      title: "Invalid email or password.",
      description:
        "Check the values, or confirm this user exists in Supabase Auth (Authentication → Users) with email confirmed.",
    };
  }
  if (m.includes("email not confirmed")) {
    return {
      title: "Email not confirmed.",
      description:
        "Open Supabase → Authentication → Users → this user → Confirm email, then try again.",
    };
  }
  if (m.includes("rate") || m.includes("too many")) {
    return {
      title: "Too many attempts.",
      description: "Wait a few seconds and retry.",
    };
  }
  return { title: message };
}

export function SignInForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [errors, setErrors] = useState<{ email?: string; password?: string }>({});
  const [formError, setFormError] = useState<FormError | null>(null);
  const resetToastShown = useRef(false);
  const authGateToastShown = useRef(false);

  useEffect(() => {
    if (searchParams.get("auth") !== "required" || authGateToastShown.current) return;
    authGateToastShown.current = true;
    if (!isSupabaseAuthConfigured()) {
      toast.error("Authentication is not configured.", {
        description:
          "Set NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY on the server, then restart the app. Dashboards stay locked until then.",
      });
    } else {
      toast.info("Sign in to access that area.");
    }
  }, [searchParams]);

  useEffect(() => {
    if (searchParams.get("reset") !== "success" || resetToastShown.current) return;
    resetToastShown.current = true;
    toast.success("Password updated successfully");
    const u = new URL(window.location.href);
    u.searchParams.delete("reset");
    window.history.replaceState({}, "", u.pathname + u.search);
  }, [searchParams]);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setFormError(null);

    const trimmedEmail = email.trim();
    const nextErrors: { email?: string; password?: string } = {};
    if (!trimmedEmail) {
      nextErrors.email = "Email is required.";
    } else if (!isValidEmail(trimmedEmail)) {
      nextErrors.email = "Enter a valid email address.";
    }
    if (!password) {
      nextErrors.password = "Password is required.";
    }
    setErrors(nextErrors);
    if (Object.keys(nextErrors).length > 0) {
      return;
    }

    if (!isSupabaseAuthConfigured()) {
      const err: FormError = {
        title: "Authentication is not configured.",
        description:
          "Set NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY in .env.local, then restart `next dev`.",
      };
      setFormError(err);
      toast.error(err.title, { description: err.description });
      return;
    }

    setLoading(true);
    const supabase = createClient();
    const { data, error: signError } = await supabase.auth.signInWithPassword({
      email: trimmedEmail,
      password,
    });

    if (process.env.NODE_ENV !== "production") {
      console.log("[signin] response", { data, error: signError });
    }

    if (signError) {
      setLoading(false);
      const err = friendlyAuthError(signError.message);
      setFormError(err);
      toast.error(err.title, { description: err.description });
      return;
    }

    const user = data.user;
    if (!user) {
      setLoading(false);
      const err: FormError = { title: "Could not load your session." };
      setFormError(err);
      toast.error(err.title);
      return;
    }

    const { data: profile, error: profileError } = await supabase
      .from("profiles")
      .select("role")
      .eq("id", user.id)
      .maybeSingle();

    if (process.env.NODE_ENV !== "production") {
      console.log("[signin] profile", { profile, profileError });
    }

    if (profileError) {
      setLoading(false);
      const err: FormError = {
        title: "Could not read your profile.",
        description: profileError.message,
      };
      setFormError(err);
      toast.error(err.title, { description: err.description });
      return;
    }

    const metaRole = (user.user_metadata as { role?: string } | null)?.role ?? null;
    const role = profile?.role ?? metaRole ?? null;

    if (!role) {
      await supabase.auth.signOut();
      setLoading(false);
      const err: FormError = {
        title: "No account profile found.",
        description: "Your account must be created by an administrator.",
      };
      setFormError(err);
      toast.error(err.title, { description: err.description });
      return;
    }

    // Login is audited by `LoginEventBootstrap` once the authenticated shell
    // mounts, so we skip awaiting it here to keep sign-in fast.

    setLoading(false);

    const nextParam = searchParams.get("next");
    const safeNext =
      nextParam?.startsWith("/") && !nextParam.startsWith("//") ? nextParam : null;

    if (role === "admin") {
      router.push(safeNext?.startsWith("/admin") ? safeNext : "/admin");
    } else {
      router.push(safeNext?.startsWith("/client") ? safeNext : "/client");
    }
    router.refresh();
  }

  return (
    <div className={authPageClass}>
      <div
        className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_80%_50%_at_50%_-20%,rgba(99,102,241,0.1),transparent)]"
        aria-hidden
      />
      <div className={`relative ${authCardClass}`}>
        <div className="mb-8 flex justify-center">
          <div
            className="flex size-9 items-center justify-center rounded-lg bg-gradient-to-br from-indigo-500 to-violet-600 shadow-lg shadow-indigo-500/15"
            aria-hidden
          >
            <Mail className="size-[18px] text-white" strokeWidth={2} />
          </div>
        </div>

        <div className="mb-8 space-y-3 text-center">
          <h1 className={authHeadingClass}>Welcome back</h1>
          <p className={authSubtextClass}>Sign in to your account</p>
        </div>

        {formError && (
          <div
            role="alert"
            aria-live="assertive"
            className="mb-6 rounded-lg border border-red-500/30 bg-red-500/10 px-4 py-3 text-[13px] leading-[1.5] text-red-200"
          >
            <p className="font-medium text-red-100">{formError.title}</p>
            {formError.description && (
              <p className="mt-1 text-red-300/90">{formError.description}</p>
            )}
          </div>
        )}

        <form onSubmit={onSubmit} className="space-y-6" noValidate>
          <div className="space-y-2">
            <Label htmlFor="signin-email" className={authLabelClass}>
              Email address
            </Label>
            <Input
              id="signin-email"
              name="email"
              type="email"
              autoComplete="email"
              value={email}
              onChange={(e) => {
                setEmail(e.target.value);
                if (errors.email) setErrors((s) => ({ ...s, email: undefined }));
              }}
              className={authFieldClass}
              placeholder="you@company.com"
              aria-invalid={Boolean(errors.email)}
              aria-describedby={errors.email ? "email-error" : undefined}
            />
            {errors.email && (
              <p id="email-error" className={authErrorClass} role="alert">
                {errors.email}
              </p>
            )}
          </div>

          <div className="space-y-2">
            <div className="flex items-center justify-between gap-2">
              <Label htmlFor="signin-password" className={authLabelClass}>
                Password
              </Label>
              <Link href="/forgot-password" className={authForgotLinkClass}>
                Forgot password?
              </Link>
            </div>
            <div className="relative">
              <Input
                id="signin-password"
                name="password"
                type={showPassword ? "text" : "password"}
                autoComplete="current-password"
                value={password}
                onChange={(e) => {
                  setPassword(e.target.value);
                  if (errors.password) setErrors((s) => ({ ...s, password: undefined }));
                }}
                className={`${authFieldClass} pr-[40px]`}
                aria-invalid={Boolean(errors.password)}
                aria-describedby={errors.password ? "password-error" : undefined}
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
              <p id="password-error" className={authErrorClass} role="alert">
                {errors.password}
              </p>
            )}
          </div>

          <button type="submit" disabled={loading} className={authSubmitClass}>
            {loading ? "Signing in…" : "Sign in"}
          </button>
        </form>

        <p className="mt-8 text-center">
          <Link href="/" className={authFooterLinkClass}>
            Back to home
          </Link>
        </p>
      </div>
    </div>
  );
}
