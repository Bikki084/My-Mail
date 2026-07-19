"use client";

import * as React from "react";
import { createPortal } from "react-dom";
import { Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";

const FADE_MS = 280;

type AuthLoadingOverlayProps = {
  visible: boolean;
  onExitComplete?: () => void;
  title?: string;
  subtitle?: string;
};

/**
 * Full-viewport auth loading overlay — shared by client and admin sign-in.
 */
export function AuthLoadingOverlay({
  visible,
  onExitComplete,
  title = "Signing you in...",
  subtitle = "Verifying your credentials. Please wait.",
}: AuthLoadingOverlayProps) {
  const [render, setRender] = React.useState(false);
  const [shown, setShown] = React.useState(false);
  const exitCallbackRef = React.useRef(onExitComplete);
  exitCallbackRef.current = onExitComplete;

  React.useLayoutEffect(() => {
    if (visible) {
      setRender(true);
      const raf = requestAnimationFrame(() => setShown(true));
      return () => cancelAnimationFrame(raf);
    }

    setShown(false);
    const timer = window.setTimeout(() => {
      setRender(false);
      exitCallbackRef.current?.();
    }, FADE_MS);
    return () => window.clearTimeout(timer);
  }, [visible]);

  React.useEffect(() => {
    if (!render) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, [render]);

  if (!render || typeof document === "undefined") return null;

  return createPortal(
    <div
      className={cn(
        "fixed inset-0 z-[9999] flex items-center justify-center px-4 transition-opacity duration-300 ease-out",
        shown ? "opacity-100" : "opacity-0",
      )}
      style={{
        backdropFilter: "blur(8px)",
        WebkitBackdropFilter: "blur(8px)",
        pointerEvents: shown ? "auto" : "none",
      }}
      aria-busy="true"
      aria-live="polite"
      aria-label={title}
    >
      <div className="absolute inset-0 bg-black/60" aria-hidden />
      <div
        className={cn(
          "relative z-10 flex max-w-sm flex-col items-center rounded-2xl border border-emerald-500/25 bg-zinc-900/90 px-10 py-9 text-center shadow-[0_24px_64px_-16px_rgba(0,0,0,0.75)] transition-transform duration-300 ease-out",
          shown ? "scale-100 translate-y-0" : "scale-[0.98] translate-y-1",
        )}
      >
        <Loader2
          className="size-12 animate-spin text-[#10B981]"
          strokeWidth={2.25}
          aria-hidden
        />
        <p className="mt-6 text-[17px] font-semibold tracking-[-0.01em] text-white">
          {title}
        </p>
        <p className="mt-2 text-[13px] leading-relaxed text-zinc-400">{subtitle}</p>
      </div>
    </div>,
    document.body,
  );
}
