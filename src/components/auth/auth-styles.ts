/**
 * Shared typography and surfaces for auth screens (Inter / system fallbacks via layout).
 */
export const authPageClass =
  "relative flex min-h-svh flex-col items-center justify-center bg-[#0B0F19] px-4 py-10 antialiased [-webkit-font-smoothing:antialiased] [-moz-osx-font-smoothing:grayscale]";

export const authCardClass =
  "relative w-full max-w-[400px] rounded-[11px] border border-gray-800/90 bg-[#111827] p-8 shadow-[0_24px_48px_-12px_rgba(0,0,0,0.5)]";

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
  "h-11 w-full rounded-lg border border-[#374151] bg-[#0F172A] px-3.5 py-3 text-[15px] font-normal leading-[1.5] text-white shadow-sm placeholder:text-gray-500 transition-colors focus-visible:border-indigo-500 focus-visible:ring-2 focus-visible:ring-indigo-500/25 focus-visible:outline-none";

export const authSubmitClass =
  "mt-2 flex h-11 w-full items-center justify-center rounded-lg bg-gradient-to-r from-indigo-600 to-violet-600 text-[15px] font-semibold leading-normal tracking-[0.02em] text-white shadow-sm transition-all hover:from-indigo-500 hover:to-violet-500 focus-visible:ring-2 focus-visible:ring-indigo-500/50 focus-visible:outline-none disabled:cursor-not-allowed disabled:opacity-50";

export const authErrorClass = "text-[13px] font-normal leading-[1.5] text-red-400";

export const authFooterLinkClass =
  "text-[14px] font-normal leading-[1.5] text-gray-400 transition-colors hover:text-gray-300 hover:underline";

export const authForgotLinkClass =
  "text-[12px] font-medium leading-normal text-indigo-400 hover:text-indigo-300 hover:underline";
