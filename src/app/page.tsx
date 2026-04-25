import Link from "next/link";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import {
  Card,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Mail, Shield, Zap } from "lucide-react";

export default function HomePage() {
  return (
    <div className="flex min-h-svh flex-col">
      <header className="border-b border-border/80 bg-card/40 backdrop-blur">
        <div className="mx-auto flex h-16 max-w-6xl items-center justify-between px-4">
          <div className="flex items-center gap-2">
            <div className="flex size-9 items-center justify-center rounded-lg bg-primary text-primary-foreground">
              <Mail className="size-5" />
            </div>
            <span className="font-semibold tracking-tight">MyMail</span>
          </div>
          <Link
            href="/login"
            className={cn(buttonVariants({ variant: "secondary" }))}
          >
            Sign in
          </Link>
        </div>
      </header>
      <main className="mx-auto flex w-full max-w-6xl flex-1 flex-col justify-center gap-10 px-4 py-16">
        <div className="space-y-4 text-center">
          <p className="text-sm font-medium text-muted-foreground">
            Bulk Email Sending SaaS
          </p>
          <h1 className="text-balance text-4xl font-bold tracking-tight md:text-5xl">
            Personalized mass email at scale
          </h1>
          <p className="mx-auto max-w-2xl text-pretty text-muted-foreground md:text-lg">
            Admin-managed credits, SMTP rotation (Gmail, Yahoo, Outlook, custom),
            CSV merge tags, BullMQ queues, and full delivery logs — as specified in
            your project proposal.
          </p>
          <div className="flex flex-wrap items-center justify-center gap-3 pt-2">
            <Link
              href="/login"
              className={cn(buttonVariants({ size: "lg" }))}
            >
              Open console
            </Link>
          </div>
        </div>
        <div className="grid gap-4 md:grid-cols-3">
          <Card>
            <CardHeader>
              <Shield className="mb-2 size-8 text-primary" />
              <CardTitle>Two panels</CardTitle>
              <CardDescription>
                Dedicated admin and client dashboards with role-based access.
              </CardDescription>
            </CardHeader>
          </Card>
          <Card>
            <CardHeader>
              <Zap className="mb-2 size-8 text-primary" />
              <CardTitle>SMTP rotation</CardTitle>
              <CardDescription>
                Round robin, random, or threshold strategies with Nodemailer.
              </CardDescription>
            </CardHeader>
          </Card>
          <Card>
            <CardHeader>
              <Mail className="mb-2 size-8 text-primary" />
              <CardTitle>Merge tags</CardTitle>
              <CardDescription>
                Merge tags for email, name, and custom columns c3–c6 from CSV uploads.
              </CardDescription>
            </CardHeader>
          </Card>
        </div>
      </main>
    </div>
  );
}
