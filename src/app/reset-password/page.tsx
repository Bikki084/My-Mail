import { Suspense } from "react";
import { ResetPasswordFormWithKey } from "@/components/auth/reset-password-form";

export default function ResetPasswordPage() {
  return (
    <Suspense
      fallback={
        <div className="flex min-h-svh items-center justify-center bg-[#0B0F19] text-gray-500">
          Loading…
        </div>
      }
    >
      <ResetPasswordFormWithKey />
    </Suspense>
  );
}
