import Link from "next/link";
import { buttonVariants } from "@/components/ui/button";
import { HomeAnimatedBackground } from "@/components/marketing/home-animated-background";
import { cn } from "@/lib/utils";
import {
  ArrowRight,
  BarChart3,
  Mail,
  Shield,
  Sparkles,
  Zap,
} from "lucide-react";

const FEATURES = [
  {
    icon: Shield,
    title: "Two panels",
    description:
      "Dedicated admin and client dashboards with role-based access and credit controls.",
  },
  {
    icon: Zap,
    title: "SMTP rotation",
    description:
      "Round robin, random, alternating, or threshold strategies across Gmail, Yahoo, Outlook, and custom SMTP.",
  },
  {
    icon: Mail,
    title: "Merge tags",
    description:
      "Personalize every message with CSV columns, built-in invoice and transaction IDs, and live preview.",
  },
] as const;

const HIGHLIGHTS = [
  "CSV recipients",
  "Live delivery logs",
  "BullMQ queue",
  "IP rotation",
] as const;

export default function HomePage() {
  return (
    <div className="relative flex min-h-svh flex-col overflow-hidden bg-black text-zinc-100">
      <HomeAnimatedBackground />

      <header className="relative z-10 border-b border-zinc-800/60 bg-zinc-950/40 backdrop-blur-md">
        <div className="mx-auto flex h-16 max-w-6xl items-center justify-between px-4 md:px-6">
          <Link
            href="/"
            className="group flex items-center gap-2.5 outline-none ring-emerald-500/40 focus-visible:rounded-lg focus-visible:ring-2"
          >
            <span className="flex size-9 items-center justify-center rounded-xl bg-gradient-to-br from-emerald-500 to-teal-600 shadow-lg shadow-emerald-950/50 ring-1 ring-white/10 transition group-hover:brightness-110">
              <Mail className="size-[1.125rem] text-white" strokeWidth={2} />
            </span>
            <span className="font-semibold tracking-tight text-zinc-50">MyMail</span>
          </Link>
          <Link
            href="/login"
            className={cn(
              buttonVariants({ variant: "outline", size: "sm" }),
              "border-zinc-700 bg-zinc-900/60 text-zinc-200 hover:border-emerald-700/60 hover:bg-emerald-950/30 hover:text-emerald-100",
            )}
          >
            Sign in
          </Link>
        </div>
      </header>

      <main className="relative z-10 mx-auto flex w-full max-w-6xl flex-1 flex-col gap-16 px-4 py-14 md:px-6 md:py-20 lg:py-24">
        <section className="mx-auto flex max-w-3xl flex-col items-center gap-8 text-center">
          <div className="inline-flex items-center gap-2 rounded-full border border-emerald-800/50 bg-emerald-950/30 px-3 py-1 text-xs font-medium text-emerald-300/90 shadow-sm shadow-emerald-950/30">
            <Sparkles className="size-3.5 text-emerald-400" aria-hidden />
            Bulk Email Sending SaaS
          </div>

          <div className="space-y-5">
            <h1 className="text-balance text-4xl font-bold tracking-tight md:text-5xl lg:text-6xl">
              <span className="text-zinc-50">Personalized mass email</span>{" "}
              <span className="bg-gradient-to-r from-emerald-300 via-emerald-400 to-teal-300 bg-clip-text text-transparent">
                at scale
              </span>
            </h1>
            <p className="mx-auto max-w-2xl text-pretty text-base leading-relaxed text-zinc-400 md:text-lg">
              Admin-managed credits, multi-SMTP rotation, CSV merge tags, queued
              delivery, and full per-recipient logs — everything you need to run
              high-volume campaigns from one console.
            </p>
          </div>

          <div className="flex flex-wrap items-center justify-center gap-3">
            <Link
              href="/login"
              className={cn(
                buttonVariants({ size: "lg" }),
                "gap-2 bg-emerald-600 px-8 text-white shadow-lg shadow-emerald-950/40 hover:bg-emerald-500",
              )}
            >
              Open console
              <ArrowRight className="size-4" aria-hidden />
            </Link>
          </div>

          <ul className="flex flex-wrap items-center justify-center gap-2 pt-1">
            {HIGHLIGHTS.map((item) => (
              <li
                key={item}
                className="rounded-md border border-zinc-800 bg-zinc-900/50 px-2.5 py-1 text-xs text-zinc-400"
              >
                {item}
              </li>
            ))}
          </ul>
        </section>

        <section className="grid gap-4 md:grid-cols-3">
          {FEATURES.map(({ icon: Icon, title, description }) => (
            <article
              key={title}
              className="group relative overflow-hidden rounded-2xl border border-zinc-800 bg-zinc-900/40 p-6 shadow-sm transition duration-300 hover:border-emerald-800/60 hover:bg-emerald-950/10 hover:shadow-[0_0_40px_-12px_rgba(16,185,129,0.25)]"
            >
              <div
                className="pointer-events-none absolute -right-8 -top-8 size-32 rounded-full bg-emerald-500/5 blur-2xl transition group-hover:bg-emerald-500/10"
                aria-hidden
              />
              <div className="relative space-y-3">
                <div className="flex size-11 items-center justify-center rounded-xl border border-emerald-900/50 bg-gradient-to-br from-emerald-950/80 to-zinc-950 text-emerald-400 shadow-inner shadow-emerald-950/50">
                  <Icon className="size-5" strokeWidth={1.75} />
                </div>
                <h2 className="text-lg font-semibold text-zinc-100">{title}</h2>
                <p className="text-sm leading-relaxed text-zinc-400">{description}</p>
              </div>
            </article>
          ))}
        </section>

        <section className="relative overflow-hidden rounded-2xl border border-emerald-900/40 bg-gradient-to-br from-emerald-950/25 via-zinc-900/60 to-zinc-950 p-8 md:p-10">
          <div
            className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_70%_80%_at_100%_50%,rgba(16,185,129,0.15),transparent_60%)]"
            aria-hidden
          />
          <div className="relative flex flex-col items-start gap-6 md:flex-row md:items-center md:justify-between">
            <div className="flex items-start gap-4">
              <div className="flex size-12 shrink-0 items-center justify-center rounded-xl bg-emerald-600/20 text-emerald-400 ring-1 ring-emerald-700/40">
                <BarChart3 className="size-6" strokeWidth={1.75} />
              </div>
              <div className="space-y-1">
                <h2 className="text-xl font-semibold text-zinc-100">
                  Track every send
                </h2>
                <p className="max-w-xl text-sm leading-relaxed text-zinc-400">
                  Watch progress in real time, paginate delivery logs, and switch
                  between all-time totals and today&apos;s batch — sent, failed, and
                  complete counts at a glance.
                </p>
              </div>
            </div>
            <Link
              href="/login"
              className={cn(
                buttonVariants({ variant: "outline" }),
                "shrink-0 border-emerald-800/60 bg-zinc-950/50 text-emerald-200 hover:border-emerald-600 hover:bg-emerald-950/40 hover:text-emerald-100",
              )}
            >
              Get started
            </Link>
          </div>
        </section>
      </main>

      <footer className="relative z-10 border-t border-zinc-800/80 py-6 text-center text-xs text-zinc-500">
        <p>MyMail — bulk email for teams that need control, rotation, and visibility.</p>
      </footer>
    </div>
  );
}
