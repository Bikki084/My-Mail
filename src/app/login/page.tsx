import { Suspense } from "react";
import { SignInForm } from "@/components/auth/sign-in-form";

export default function LoginPage() {
  return (
    <Suspense
      fallback={
        <div className="flex min-h-svh items-center justify-center bg-[#0B0F19] text-gray-500">
          Loading…
        </div>
      }
    >
      <SignInForm />
    </Suspense>
  );
}
