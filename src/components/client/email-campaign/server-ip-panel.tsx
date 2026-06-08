"use client";

import * as React from "react";
import { Loader2, RefreshCw, Save, ShieldCheck } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import type { AwsOutboundIpMode } from "@/lib/aws-outbound-ip";
import {
  getServerIpAction,
  rotateServerIpAction,
  setRotationThresholdAction,
  type ServerIpSnapshot,
} from "@/app/actions/server-ip";

function modeLabel(mode: AwsOutboundIpMode): string {
  switch (mode) {
    case "aws_lightsail":
      return "AWS Lightsail";
    case "aws_ec2":
      return "AWS EC2";
    case "rotation_url":
      return "Rotation URL";
    case "instance":
      return "Server IP";
    case "dev_stub":
    default:
      return "Dev stub";
  }
}

function leaseHint(snapshot: ServerIpSnapshot): string {
  if (snapshot.poolRotation) {
    const site = snapshot.websiteIp
      ? `Website stays on ${snapshot.websiteIp}. `
      : "";
    return `${site}Click Refresh to switch the active send IP to the next address in your AWS static IP pool — the app does not go down.`;
  }
  if (snapshot.rotationConfigured) {
    return `Full AWS attach-swap is active (${modeLabel(snapshot.mode)}). Refresh moves the whole server to the next IP (website URL changes).`;
  }
  if (snapshot.mode === "instance") {
    return `Displaying this server's public IP (${snapshot.ip}). For real rotation between 2+ IPs, set AWS_LIGHTSAIL_STATIC_IP_NAMES and AWS_LIGHTSAIL_INSTANCE_NAME in .env.local on the VPS, then restart PM2.`;
  }
  return "Development stub: the panel stores a random IP for testing. SMTP still uses the server's real network route until AWS rotation is configured.";
}

function formatExpire(iso: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleString(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  });
}

export function ServerIpPanel({ previewMode = false }: { previewMode?: boolean }) {
  const [snapshot, setSnapshot] = React.useState<ServerIpSnapshot | null>(null);
  const [loading, setLoading] = React.useState(true);
  const [rotating, setRotating] = React.useState(false);
  const [savingThreshold, setSavingThreshold] = React.useState(false);
  const [thresholdDraft, setThresholdDraft] = React.useState<string>("1000");
  const [error, setError] = React.useState<string | null>(null);

  const refresh = React.useCallback(async () => {
    if (previewMode) {
      setSnapshot({
        ip: "32.192.186.36",
        websiteIp: null,
        expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
        rotationThreshold: 1000,
        defaultThreshold: 1000,
        maxThreshold: 100_000,
        mode: "dev_stub",
        rotationConfigured: false,
        poolRotation: false,
        autoRotateOnThreshold: false,
      });
      setThresholdDraft("1000");
      setLoading(false);
      return;
    }
    setLoading(true);
    const res = await getServerIpAction();
    if (!res.ok) {
      setError(res.error);
      setLoading(false);
      return;
    }
    setError(null);
    setSnapshot(res.data);
    setThresholdDraft(String(res.data.rotationThreshold));
    setLoading(false);
  }, [previewMode]);

  // External-system sync (Supabase row read). The setState calls run after
  // an `await`, so the cascading-render rule doesn't actually apply.
  React.useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void refresh();
  }, [refresh]);

  async function handleRotate() {
    if (previewMode) {
      toast.message("Sign in with Supabase to rotate the outbound IP.");
      return;
    }
    setRotating(true);
    try {
      const res = await Promise.race([
        rotateServerIpAction(),
        new Promise<{ ok: false; error: string }>((resolve) => {
          window.setTimeout(
            () =>
              resolve({
                ok: false,
                error:
                  "Rotation is taking longer than expected. Check AWS credentials and static IP names on the server, then try again.",
              }),
            20_000,
          );
        }),
      ]);
      if (!res.ok) {
        toast.error("Could not rotate outbound IP", { description: res.error });
        return;
      }
      setSnapshot(res.data);
      setThresholdDraft(String(res.data.rotationThreshold));
      toast.success("Active send IP updated", {
        description: res.data.poolRotation
          ? `Now using ${res.data.ip} for this send cycle. Your website stays on ${res.data.websiteIp ?? "the primary IP"}.`
          : `Now sending from ${res.data.ip}.`,
      });
    } finally {
      setRotating(false);
    }
  }

  async function handleSaveThreshold() {
    if (previewMode) {
      toast.message("Sign in with Supabase to save the rotation threshold.");
      return;
    }
    const n = Math.floor(Number(thresholdDraft));
    if (!Number.isFinite(n) || n <= 0) {
      toast.error("Enter a positive integer for the rotation threshold.");
      return;
    }
    setSavingThreshold(true);
    const res = await setRotationThresholdAction(n);
    setSavingThreshold(false);
    if (!res.ok) {
      toast.error("Could not save rotation threshold", { description: res.error });
      return;
    }
    setSnapshot((prev) =>
      prev ? { ...prev, rotationThreshold: res.data.rotationThreshold } : prev,
    );
    setThresholdDraft(String(res.data.rotationThreshold));
    toast.success(
      `Will pause campaigns after every ${res.data.rotationThreshold.toLocaleString()} sends.`,
    );
  }

  const ip = snapshot?.ip ?? "—";
  const expires = formatExpire(snapshot?.expiresAt ?? null);
  const thresholdNum = Math.floor(Number(thresholdDraft));
  const thresholdValid =
    Number.isFinite(thresholdNum) &&
    thresholdNum > 0 &&
    thresholdNum <= (snapshot?.maxThreshold ?? 100_000);
  const thresholdDirty =
    snapshot != null && thresholdValid && thresholdNum !== snapshot.rotationThreshold;

  return (
    <Card className="border-zinc-800 bg-zinc-900/40 ring-zinc-800">
      <CardHeader className="space-y-0.5 pb-3">
        <CardTitle className="flex flex-wrap items-center gap-2 text-base text-zinc-100">
          Server &amp; outbound IP
          {snapshot && !loading ? (
            <Badge
              variant="outline"
              className={cn(
                "text-xs font-normal",
                snapshot.rotationConfigured
                  ? "border-emerald-700/80 bg-emerald-950/50 text-emerald-200"
                  : "border-amber-700/80 bg-amber-950/40 text-amber-200",
              )}
            >
              {snapshot.poolRotation
                ? `${modeLabel(snapshot.mode)} · pool rotation`
                : snapshot.rotationConfigured
                  ? `${modeLabel(snapshot.mode)} · live rotation`
                  : `${modeLabel(snapshot.mode)} · read-only`}
            </Badge>
          ) : null}
        </CardTitle>
        <CardDescription>
          {snapshot?.poolRotation ? (
            <>
              Your website stays on the primary IP. The active send IP below is used for mail —
              while a campaign is sending, AWS briefly attaches that IP for real SMTP egress, then
              restores the website IP when the batch finishes. After every{" "}
              <span className="text-zinc-300">{snapshot?.rotationThreshold ?? 1000}</span> sends,{" "}
              {snapshot?.autoRotateOnThreshold ? (
                <>the app switches to the next pool IP automatically.</>
              ) : (
                <>
                  the campaign pauses — click Refresh IP, then resume on Sending &amp; Logs.
                </>
              )}
            </>
          ) : (
            <>
              Outbound mail egresses from this server&apos;s public IP. After every{" "}
              <span className="text-zinc-300">{snapshot?.rotationThreshold ?? 1000}</span> successful
              sends,{" "}
              {snapshot?.autoRotateOnThreshold ? (
                <>
                  the app <span className="text-zinc-300">automatically rotates</span> the IP and
                  continues sending on the new address.
                </>
              ) : (
                <>
                  the campaign <span className="text-zinc-300">pauses</span> — click Refresh IP here,
                  then resume on Sending &amp; Logs.
                </>
              )}
            </>
          )}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {error ? (
          <div className="rounded-lg border border-red-800/60 bg-red-950/30 px-3 py-2 text-sm text-red-200">
            {error}
          </div>
        ) : null}

        <div className="space-y-2">
          <p className="text-xs font-medium text-zinc-400">
            {snapshot?.poolRotation ? "Active send IP" : "Server IP"}
          </p>
          <div className="flex gap-2">
            <div
              className={cn(
                "flex min-h-11 min-w-0 flex-1 items-center rounded-lg border border-[#374151] bg-[#0B0F19] px-3 font-mono text-sm text-white tabular-nums",
                loading && "text-zinc-500",
              )}
            >
              {loading ? "Loading…" : ip}
            </div>
            <Button
              type="button"
              variant="outline"
              size="icon"
              className={cn(
                "h-11 w-11 shrink-0 border-[#374151] bg-[#0B0F19] text-zinc-300 hover:border-[#4B5563] hover:bg-[#1F2937] hover:text-white",
              )}
              aria-label="Refresh IP"
              title="Rotate outbound IP"
              disabled={rotating || loading || previewMode}
              onClick={() => void handleRotate()}
            >
              {rotating ? (
                <Loader2 className="size-4 animate-spin" strokeWidth={2} />
              ) : (
                <RefreshCw className="size-4" strokeWidth={2} />
              )}
            </Button>
          </div>
          <p className="text-xs text-zinc-500">
            <ShieldCheck className="mr-1 inline-block size-3.5 align-text-bottom text-emerald-500/80" />
            Lease expires <span className="text-zinc-300">{expires}</span>.{" "}
            {snapshot ? leaseHint(snapshot) : null}
          </p>
          {snapshot?.poolRotation && snapshot.websiteIp ? (
            <p className="text-xs text-zinc-500">
              Website URL (unchanged):{" "}
              <span className="font-mono text-zinc-300">{snapshot.websiteIp}</span>
            </p>
          ) : null}
        </div>

        <div className="space-y-2 border-t border-zinc-800 pt-3">
          <Label htmlFor="ip-rotation-threshold" className="text-zinc-300">
            Rotate after how many sends?
          </Label>
          <div className="flex flex-wrap gap-2">
            <Input
              id="ip-rotation-threshold"
              type="number"
              min={1}
              max={snapshot?.maxThreshold ?? 100_000}
              step={50}
              inputMode="numeric"
              value={thresholdDraft}
              disabled={loading || savingThreshold || previewMode}
              onChange={(e) => setThresholdDraft(e.target.value)}
              className="h-11 max-w-[10rem] bg-zinc-950/60 font-mono"
            />
            <Button
              type="button"
              size="lg"
              variant="outline"
              className="h-11 border-zinc-700"
              disabled={!thresholdDirty || savingThreshold || previewMode}
              onClick={() => void handleSaveThreshold()}
            >
              {savingThreshold ? (
                <Loader2 className="size-4 animate-spin" />
              ) : (
                <Save className="size-4" />
              )}
              Save threshold
            </Button>
          </div>
          {!thresholdValid ? (
            <p className="text-xs text-red-400">
              Enter a number between 1 and{" "}
              {(snapshot?.maxThreshold ?? 100_000).toLocaleString()}.
            </p>
          ) : (
            <p className="text-xs text-zinc-500">
              Default {snapshot?.defaultThreshold ?? 1000}. Lower values protect new IPs; raise once
              you have warmed up.
            </p>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
