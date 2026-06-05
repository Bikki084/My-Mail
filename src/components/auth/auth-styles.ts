/**
 * Shared typography and surfaces for auth screens (Inter / system fallbacks via layout).
 */
export const authPageClass =
  "relative flex min-h-svh flex-col items-center justify-center overflow-hidden bg-black px-4 py-10 antialiased [-webkit-font-smoothing:antialiased] [-moz-osx-font-smoothing:grayscale]";

export const authCardClass =
  "relative z-10 w-full max-w-[400px] rounded-2xl border border-emerald-900/35 bg-zinc-900/75 p-8 shadow-[0_24px_48px_-12px_rgba(0,0,0,0.55)] backdrop-blur-md";

export const authIconClass =
  "flex size-9 items-center justify-center rounded-xl bg-gradient-to-br from-emerald-500 to-teal-600 shadow-lg shadow-emerald-950/40 ring-1 ring-white/10";

/** "Welcome back" — 28–32px, semibold, tight tracking */
export const authHeadingClass =
  "text-[1.75rem] font-semibold leading-[1.3] tracking-[-0.01em] text-white sm:text-[2rem]";

/** Subtext — 14–16px, muted */
export const authSubtextClass =
  "text-[15px] font-normal leading-[1.55] text-[#9CA3AF]";

/** Form labels */
export const authLabelClass =
  "text-[13px] font-medium leading-normal text-[#D1D5DB]";

export const authFieldClass =
  "h-11 w-full rounded-lg border border-zinc-700 bg-zinc-950/80 px-3.5 py-3 text-[15px] font-normal leading-[1.5] text-white shadow-sm placeholder:text-zinc-500 transition-colors focus-visible:border-emerald-600 focus-visible:ring-2 focus-visible:ring-emerald-500/25 focus-visible:outline-none";

export const authSubmitClass =
  "mt-2 flex h-11 w-full items-center justify-center rounded-lg bg-gradient-to-r from-emerald-600 to-teal-600 text-[15px] font-semibold leading-normal tracking-[0.02em] text-white shadow-lg shadow-emerald-950/30 transition-all hover:from-emerald-500 hover:to-teal-500 focus-visible:ring-2 focus-visible:ring-emerald-500/50 focus-visible:outline-none disabled:cursor-not-allowed disabled:opacity-50";

export const authToggleButtonClass =
  "absolute right-2 top-1/2 flex size-9 -translate-y-1/2 cursor-pointer items-center justify-center rounded-md text-zinc-400 transition-colors hover:text-zinc-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500/40";

export const authErrorClass = "text-[13px] font-normal leading-[1.5] text-red-400";

export const authFooterLinkClass =
  "text-[14px] font-normal leading-[1.5] text-gray-400 transition-colors hover:text-gray-300 hover:underline";

export const authForgotLinkClass =
  "text-[12px] font-medium leading-normal text-emerald-400 hover:text-emerald-300 hover:underline";
