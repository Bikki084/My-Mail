"use client";

import { useCallback, useEffect, useState } from "react";
import { Loader2, RefreshCw } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { refreshBrevoQuota } from "@/app/admin/brevo-quota-actions";
import type { BrevoQuotaSnapshot } from "@/lib/brevo/account";

function formatFetchedAt(iso: string): string {
  try {
    return new Date(iso).toLocaleString(undefined, {
      dateStyle: "short",
      timeStyle: "short",
    });
  } catch {
    return iso;
  }
}

function periodLabel(period?: "day" | "month"): string {
  return period === "month" ? "this month" : "today";
}

export function BrevoQuotaPanel({ initial }: { initial: BrevoQuotaSnapshot }) {
  const [quota, setQuota] = useState(initial);
  const [refreshing, setRefreshing] = useState(false);

  const refresh = useCallback(async (force = true) => {
    setRefreshing(true);
    try {
      const next = await refreshBrevoQuota(force);
      setQuota(next);
    } finally {
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    const timer = window.setInterval(() => {
      void refresh(true);
    }, 120_000);
    return () => window.clearInterval(timer);
  }, [refresh]);

  const hasUsageBar =
    quota.live &&
    quota.limit != null &&
    quota.remaining != null &&
    quota.used != null;

  const usagePct =
    hasUsageBar && quota.limit! > 0
      ? Math.min(100, Math.round((quota.used! / quota.limit!) * 100))
      : 0;

  return (
    <Card className="border-gray-800 bg-[#111827]">
      <CardHeader className="flex flex-row items-start justify-between gap-4 space-y-0 pb-2">
        <div>
          <CardTitle className="text-base font-semibold text-white">Brevo email quota</CardTitle>
          <p className="mt-1 text-sm text-gray-400">
            Live relay usage from your Brevo account (shared across all sends using this relay).
          </p>
        </div>
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="shrink-0 border-gray-700 bg-transparent text-gray-200 hover:bg-gray-800"
          disabled={refreshing || !quota.configured}
          onClick={() => void refresh(true)}
        >
          {refreshing ? (
            <Loader2 className="mr-2 size-4 animate-spin" />
          ) : (
            <RefreshCw className="mr-2 size-4" />
          )}
          Refresh
        </Button>
      </CardHeader>
      <CardContent className="space-y-4">
        {!quota.configured ? (
          <p className="text-sm text-amber-200/90">
            Add <code className="rounded bg-black/40 px-1.5 py-0.5 font-mono text-xs">BREVO_API_KEY</code>{" "}
            to <code className="font-mono text-xs">.env.local</code> on the server (Brevo → Settings → SMTP
            &amp; API → API keys), then redeploy.
          </p>
        ) : quota.error && !quota.live ? (
          <p className="text-sm text-red-300">{quota.error}</p>
        ) : (
          <>
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
              <div>
                <p className="text-xs font-medium uppercase tracking-wide text-gray-500">Active plan</p>
                <p className="mt-1 text-2xl font-semibold text-white">
                  {quota.planLabel ?? "—"}
                </p>
                {quota.planType && (
                  <p className="text-xs text-gray-500">{quota.planType}</p>
                )}
              </div>
              <div>
                <p className="text-xs font-medium uppercase tracking-wide text-gray-500">
                  Used {periodLabel(quota.period)}
                </p>
                <p className="mt-1 text-2xl font-semibold tabular-nums text-white">
                  {quota.used != null ? quota.used.toLocaleString() : "—"}
                </p>
                {quota.limit != null && (
                  <p className="text-xs text-gray-500">of {quota.limit.toLocaleString()} limit</p>
                )}
              </div>
              <div>
                <p className="text-xs font-medium uppercase tracking-wide text-gray-500">
                  Remaining {periodLabel(quota.period)}
                </p>
                <p className="mt-1 text-2xl font-semibold tabular-nums text-emerald-400">
                  {quota.remaining != null ? quota.remaining.toLocaleString() : "—"}
                </p>
              </div>
              <div>
                <p className="text-xs font-medium uppercase tracking-wide text-gray-500">Brevo account</p>
                <p className="mt-1 truncate text-sm font-medium text-gray-200">
                  {quota.accountEmail ?? "—"}
                </p>
                <p className="text-xs text-gray-500">
                  Updated {formatFetchedAt(quota.fetchedAt)}
                </p>
              </div>
            </div>

            {hasUsageBar && (
              <div>
                <div className="mb-1 flex justify-between text-xs text-gray-400">
                  <span>Daily usage (Free plan)</span>
                  <span className="tabular-nums">
                    {quota.used!.toLocaleString()} / {quota.limit!.toLocaleString()}
                  </span>
                </div>
                <div className="h-2 overflow-hidden rounded-full bg-gray-800">
                  <div
                    className={`h-full rounded-full transition-all ${
                      usagePct >= 90 ? "bg-red-500" : usagePct >= 70 ? "bg-amber-500" : "bg-emerald-500"
                    }`}
                    style={{ width: `${usagePct}%` }}
                  />
                </div>
              </div>
            )}

            {quota.live && quota.period === "month" && quota.remaining != null && (
              <p className="text-xs text-gray-500">
                Paid Brevo plans use a monthly email pool. Remaining:{" "}
                <span className="tabular-nums text-gray-300">
                  {quota.remaining.toLocaleString()}
                </span>{" "}
                emails this month.
              </p>
            )}
          </>
        )}
      </CardContent>
    </Card>
  );
}
