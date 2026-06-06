"use client";

import * as React from "react";
import { CheckCircle2, Loader2, Octagon, RefreshCw, ShieldAlert, X } from "lucide-react";
import { toast } from "sonner";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { rotateServerIpAction } from "@/app/actions/server-ip";

/**
 * Polled view of the user's most-recent in-flight / paused / recently
 * completed campaign. Mirrors the contract of the GET /api/campaigns/active
 * route — keep them in sync.
 */
type ActiveCampaign = {
  id: string;
  status:
    | "queued"
    | "sending"
    | "paused"
    | "completed"
    | "failed"
    | "cancelled";
  pauseReason: string | null;
  totalEmails: number;
  sentCount: number;
  failedCount: number;
  sentSoFar: number;
  failedSoFar: number;
  currentOutboundIp: string | null;
  ipRotationThreshold: number | null;
  pausedAt: string | null;
  updatedAt: string;
  streamName: string;
  /** Set by /api/campaigns/[id]/send when background delivery throws. */
  lastError: string | null;
};

const POLL_MS = 2_500;
const STUCK_QUEUED_MS = 30_000;
const COMPLETION_NOTIFIED_KEY = "mymail.campaign.completion-notified.v1";
const STUCK_QUEUED_TOAST_KEY = "mymail.campaign.stuck-queued-toast.v1";

function readCompletionMemo(): Set<string> {
  try {
    const raw = localStorage.getItem(COMPLETION_NOTIFIED_KEY);
    if (!raw) return new Set();
    const arr = JSON.parse(raw);
    return new Set(Array.isArray(arr) ? arr.filter((v) => typeof v === "string") : []);
  } catch {
    return new Set();
  }
}

function writeCompletionMemo(s: Set<string>) {
  try {
    // Keep only the most recent 50 ids so the entry list never grows unbounded.
    const trimmed = Array.from(s).slice(-50);
    localStorage.setItem(COMPLETION_NOTIFIED_KEY, JSON.stringify(trimmed));
  } catch {
    /* ignore quota / private-mode failures */
  }
}

export function CampaignProgressMonitor({
  previewMode = false,
}: {
  previewMode?: boolean;
}) {
  const [active, setActive] = React.useState<ActiveCampaign | null>(null);
  const [resuming, setResuming] = React.useState(false);
  const [stopping, setStopping] = React.useState(false);
  // Auto-popup state — both modals can open programmatically based on `active`,
  // but the user can dismiss them manually too (e.g. close success modal early).
  const [pauseModalOpen, setPauseModalOpen] = React.useState(false);
  const [completionModalOpen, setCompletionModalOpen] = React.useState(false);
  const [completionInfo, setCompletionInfo] = React.useState<{
    status: "completed" | "failed";
    sent: number;
    failed: number;
    total: number;
    streamName: string;
    lastError: string | null;
  } | null>(null);
  const completionMemoRef = React.useRef<Set<string> | null>(null);
  // Remember the last schemaError we toasted so a 1-Hz poll loop doesn't fire
  // a fresh toast every 2.5s if the schema is broken (e.g. forgotten migration).
  const schemaErrorMemoRef = React.useRef<string | null>(null);
  const stuckQueuedToastRef = React.useRef<string | null>(null);

  // Hydrate the "already notified" memo from localStorage on mount. Done in
  // an effect (not during render) so the ref access stays out of the render
  // path. Effects are how React expects sync-with-external-system reads.
  React.useEffect(() => {
    if (completionMemoRef.current == null) {
      completionMemoRef.current = readCompletionMemo();
    }
  }, []);

  React.useEffect(() => {
    if (previewMode) return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;

    async function poll() {
      try {
        const res = await fetch("/api/campaigns/active", {
          credentials: "include",
          cache: "no-store",
        });
        if (!cancelled && res.ok) {
          const j = (await res.json()) as {
            campaign: ActiveCampaign | null;
            schemaError?: string;
          };
          setActive(j.campaign);
          // Surface a schema-error toast at most once per distinct message.
          // This is what makes the previous failure mode loud: when a
          // migration is missing, `/active` now returns a 200 with an
          // explanation, the user sees a one-time warning toast pointing at
          // `npm run db:migrate`, and the dev console isn't drowned in 500s.
          if (j.schemaError && schemaErrorMemoRef.current !== j.schemaError) {
            schemaErrorMemoRef.current = j.schemaError;
            toast.warning("Database schema is out of date", {
              description: j.schemaError,
              duration: 12_000,
            });
          }
        }
      } catch {
        // Network blip — try again on the next tick. Don't surface a toast
        // here because the page is still usable even when the poll fails.
      } finally {
        if (!cancelled) {
          timer = setTimeout(poll, POLL_MS);
        }
      }
    }
    void poll();
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [previewMode]);

  // Drive modal visibility from the polled state — this is the "subscribe to
  // an external system" shape the rule actually allows: state changes here
  // come from server polling, not from React state we already have. The
  // setState calls only run when the polled snapshot transitions to a
  // user-facing event (pause, complete, idle), which happens at most once
  // per poll cycle, so cascading-render risk is bounded.
  /* eslint-disable react-hooks/set-state-in-effect */
  React.useEffect(() => {
    if (!active) {
      setPauseModalOpen(false);
      return;
    }
    if (active.status === "cancelled") {
      setPauseModalOpen(false);
      setCompletionModalOpen(false);
      return;
    }
    if (active.status === "paused" && active.pauseReason === "rotate_ip") {
      setPauseModalOpen(true);
      return;
    }
    setPauseModalOpen(false);
    if (active.status === "completed" || active.status === "failed") {
      const memo = completionMemoRef.current ?? new Set<string>();
      if (!memo.has(active.id)) {
        memo.add(active.id);
        completionMemoRef.current = memo;
        writeCompletionMemo(memo);
        setCompletionInfo({
          status: active.status,
          sent: active.sentSoFar,
          failed: active.failedSoFar,
          total: active.totalEmails,
          streamName: active.streamName,
          lastError: active.lastError,
        });
        setCompletionModalOpen(true);
      }
    }
  }, [active]);

  React.useEffect(() => {
    if (!active || active.status !== "queued") return;
    if (active.sentSoFar > 0 || active.failedSoFar > 0) return;
    const ageMs = Date.now() - Date.parse(active.updatedAt);
    if (!Number.isFinite(ageMs) || ageMs < STUCK_QUEUED_MS) return;
    if (stuckQueuedToastRef.current === active.id) return;
    try {
      const memo = JSON.parse(
        localStorage.getItem(STUCK_QUEUED_TOAST_KEY) ?? "[]",
      );
      if (Array.isArray(memo) && memo.includes(active.id)) return;
    } catch {
      /* ignore */
    }
    stuckQueuedToastRef.current = active.id;
    toast.error("Campaign is stuck in the queue", {
      duration: 14_000,
      description:
        "Redis accepted the job but no email worker is processing it. On the server run `pm2 start npm --name mymail-worker -- run worker` (same .env.local as the web app), or click Send again after deploying the latest app (small sends run in-process without a worker).",
    });
    try {
      const prev = JSON.parse(localStorage.getItem(STUCK_QUEUED_TOAST_KEY) ?? "[]");
      const ids = Array.isArray(prev) ? prev.filter((v) => typeof v === "string") : [];
      ids.push(active.id);
      localStorage.setItem(STUCK_QUEUED_TOAST_KEY, JSON.stringify(ids.slice(-30)));
    } catch {
      /* ignore */
    }
  }, [active]);
  /* eslint-enable react-hooks/set-state-in-effect */

  const sentCount = active?.sentSoFar ?? 0;
  const failedCount = active?.failedSoFar ?? 0;
  const total = active?.totalEmails ?? 0;
  const remaining = Math.max(0, total - sentCount - failedCount);
  const pct = total > 0 ? Math.min(100, Math.round((sentCount / total) * 100)) : 0;

  const canStop =
    active != null &&
    (active.status === "queued" || active.status === "sending");

  async function handleStopSend() {
    if (!active || !canStop) return;
    setStopping(true);
    try {
      const res = await fetch(`/api/campaigns/${active.id}/cancel`, {
        method: "POST",
        credentials: "include",
      });
      const body = (await res.json().catch(() => ({}))) as {
        ok?: boolean;
        error?: string;
      };
      if (!res.ok || !body.ok) {
        toast.error("Could not stop send", {
          description: typeof body.error === "string" ? body.error : "Unknown error",
        });
        return;
      }
      toast.success("Send stopped", {
        description: "No further emails will be sent for this campaign.",
      });
    } catch (e) {
      toast.error("Could not stop send", {
        description: e instanceof Error ? e.message : String(e),
      });
    } finally {
      setStopping(false);
    }
  }

  async function handleRefreshAndResume() {
    if (!active) return;
    setResuming(true);
    try {
      const ipRes = await rotateServerIpAction();
      if (!ipRes.ok) {
        toast.error("Could not rotate outbound IP", { description: ipRes.error });
        return;
      }
      const resumeRes = await fetch(`/api/campaigns/${active.id}/resume`, {
        method: "POST",
        credentials: "include",
      });
      const body = (await resumeRes.json().catch(() => ({}))) as {
        ok?: boolean;
        error?: string;
        mode?: string;
      };
      if (!resumeRes.ok || !body.ok) {
        toast.error("Could not resume campaign", {
          description:
            typeof body.error === "string" ? body.error : "Unknown server error.",
        });
        return;
      }
      toast.success("New IP active — sending the rest", {
        description: `Now sending from ${ipRes.data.ip}.`,
      });
      setPauseModalOpen(false);
    } catch (e) {
      toast.error("Could not resume campaign", {
        description: e instanceof Error ? e.message : String(e),
      });
    } finally {
      setResuming(false);
    }
  }

  return (
    <>
      {canStop && !previewMode ? (
        <div
          role="status"
          className="fixed bottom-4 left-1/2 z-50 flex w-[min(100%,28rem)] -translate-x-1/2 flex-wrap items-center justify-between gap-3 rounded-xl border border-red-500/40 bg-zinc-950/95 px-4 py-3 shadow-lg shadow-black/40 backdrop-blur-sm"
        >
          <div className="min-w-0 text-sm text-zinc-200">
            <span className="font-medium text-zinc-50">Sending in progress</span>
            <span className="mt-0.5 block tabular-nums text-zinc-400">
              {sentCount.toLocaleString()} sent · {remaining.toLocaleString()} remaining
            </span>
          </div>
          <Button
            type="button"
            variant="destructive"
            size="sm"
            className="shrink-0"
            disabled={stopping}
            onClick={() => void handleStopSend()}
          >
            {stopping ? (
              <Loader2 className="size-4 animate-spin" />
            ) : (
              <Octagon className="size-4" />
            )}
            Stop mail
          </Button>
        </div>
      ) : null}
      <Dialog
        open={pauseModalOpen}
        onOpenChange={(o) => {
          if (!o) setPauseModalOpen(false);
        }}
      >
        <DialogContent
          className="border-amber-500/30 bg-zinc-950 text-zinc-100 sm:max-w-md"
          showCloseButton={false}
        >
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-amber-100">
              <ShieldAlert className="size-5 text-amber-400" />
              Server IP needs to change
            </DialogTitle>
            <DialogDescription className="text-zinc-400">
              To prevent spam-inboxing on{" "}
              <span className="text-zinc-200">
                {active?.streamName?.trim() || "your campaign"}
              </span>
              , rotate the outbound IP and the remaining recipients will be sent
              automatically.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3 text-sm">
            <Progress
              value={pct}
              className="w-full [&_[data-slot=progress-track]]:h-2 [&_[data-slot=progress-track]]:bg-zinc-800 [&_[data-slot=progress-indicator]]:bg-emerald-500/90"
            />
            <dl className="grid grid-cols-3 gap-2 text-center">
              <div className="rounded-md border border-zinc-800 bg-zinc-900/60 px-2 py-2">
                <dt className="text-[11px] uppercase tracking-wide text-zinc-500">Sent</dt>
                <dd className="text-lg font-semibold tabular-nums text-emerald-300">
                  {sentCount.toLocaleString()}
                </dd>
              </div>
              <div className="rounded-md border border-zinc-800 bg-zinc-900/60 px-2 py-2">
                <dt className="text-[11px] uppercase tracking-wide text-zinc-500">Remaining</dt>
                <dd className="text-lg font-semibold tabular-nums text-zinc-100">
                  {remaining.toLocaleString()}
                </dd>
              </div>
              <div className="rounded-md border border-zinc-800 bg-zinc-900/60 px-2 py-2">
                <dt className="text-[11px] uppercase tracking-wide text-zinc-500">Failed</dt>
                <dd className="text-lg font-semibold tabular-nums text-red-300">
                  {failedCount.toLocaleString()}
                </dd>
              </div>
            </dl>
            {active?.currentOutboundIp ? (
              <p className="text-xs text-zinc-500">
                Paused on IP{" "}
                <span className="font-mono text-zinc-300">{active.currentOutboundIp}</span>
                {active.ipRotationThreshold ? (
                  <>
                    {" "}
                    after the{" "}
                    <span className="text-zinc-300">
                      {active.ipRotationThreshold.toLocaleString()}
                    </span>{" "}
                    -send burst limit was reached.
                  </>
                ) : null}
              </p>
            ) : null}
          </div>
          <DialogFooter className="gap-2 sm:justify-end">
            <Button
              type="button"
              variant="ghost"
              className="text-zinc-400"
              disabled={resuming}
              onClick={() => setPauseModalOpen(false)}
            >
              <X className="size-4" />
              Keep paused
            </Button>
            <Button
              type="button"
              className="bg-emerald-600 text-white hover:bg-emerald-500"
              disabled={resuming}
              onClick={() => void handleRefreshAndResume()}
            >
              {resuming ? (
                <Loader2 className="size-4 animate-spin" />
              ) : (
                <RefreshCw className="size-4" />
              )}
              Refresh IP &amp; continue
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog
        open={completionModalOpen}
        onOpenChange={(o) => {
          if (!o) setCompletionModalOpen(false);
        }}
      >
        <DialogContent
          className="border-emerald-500/25 bg-zinc-950 text-zinc-100 sm:max-w-md"
          showCloseButton
        >
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-emerald-200">
              {completionInfo?.status === "failed" ? (
                <ShieldAlert className="size-5 text-red-400" />
              ) : (
                <CheckCircle2 className="size-5 text-emerald-400" />
              )}
              {completionInfo?.status === "failed"
                ? "Campaign finished with errors"
                : completionInfo &&
                    completionInfo.failed === 0 &&
                    completionInfo.sent === completionInfo.total
                  ? `All ${completionInfo.total.toLocaleString()} mails sent successfully`
                  : "Campaign finished"}
            </DialogTitle>
            <DialogDescription className="text-zinc-400">
              {completionInfo?.streamName?.trim() ? (
                <>
                  Stream{" "}
                  <span className="font-medium text-zinc-200">
                    {completionInfo.streamName}
                  </span>{" "}
                  is done.
                </>
              ) : (
                "Delivery is done."
              )}
            </DialogDescription>
          </DialogHeader>
          {completionInfo ? (
            <div className="space-y-3">
              <dl className="grid grid-cols-3 gap-2 text-center text-sm">
                <div className="rounded-md border border-zinc-800 bg-zinc-900/60 px-2 py-2">
                  <dt className="text-[11px] uppercase tracking-wide text-zinc-500">Total</dt>
                  <dd className="text-lg font-semibold tabular-nums text-zinc-100">
                    {completionInfo.total.toLocaleString()}
                  </dd>
                </div>
                <div className="rounded-md border border-zinc-800 bg-zinc-900/60 px-2 py-2">
                  <dt className="text-[11px] uppercase tracking-wide text-zinc-500">Sent</dt>
                  <dd className="text-lg font-semibold tabular-nums text-emerald-300">
                    {completionInfo.sent.toLocaleString()}
                  </dd>
                </div>
                <div className="rounded-md border border-zinc-800 bg-zinc-900/60 px-2 py-2">
                  <dt className="text-[11px] uppercase tracking-wide text-zinc-500">Failed</dt>
                  <dd className="text-lg font-semibold tabular-nums text-red-300">
                    {completionInfo.failed.toLocaleString()}
                  </dd>
                </div>
              </dl>
              {completionInfo.lastError ? (
                <div className="rounded-md border border-red-500/30 bg-red-950/30 px-3 py-2 text-xs text-red-200">
                  <p className="font-semibold uppercase tracking-wide text-red-300">
                    Reason
                  </p>
                  <p className="mt-1 whitespace-pre-wrap break-words font-mono leading-relaxed">
                    {completionInfo.lastError}
                  </p>
                </div>
              ) : completionInfo.status === "failed" &&
                completionInfo.sent === 0 &&
                completionInfo.failed === 0 ? (
                <p className="rounded-md border border-amber-500/30 bg-amber-950/20 px-3 py-2 text-xs text-amber-200">
                  No recipients were attempted. The send aborted before any message
                  left the server — usually missing SMTP servers, a stale bulk-import
                  scope, or a database migration not applied on Supabase (
                  <span className="font-mono">npm run db:migrate</span> on the
                  server). Confirm SMTP appears under Saved SMTP servers, then try
                  Send again.
                </p>
              ) : null}
            </div>
          ) : null}
          <DialogFooter className="gap-2 sm:justify-end">
            <Button
              type="button"
              className="bg-emerald-600 text-white hover:bg-emerald-500"
              onClick={() => setCompletionModalOpen(false)}
            >
              Got it
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
