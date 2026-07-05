import { NextResponse } from "next/server";
import { isQueueConfigured, pingRedis } from "@/lib/queue/email-queue";
import { hasRegisteredEmailWorker } from "@/lib/queue/worker-presence";

/** Lightweight probe for Nginx / uptime checks — includes Redis + worker status. */
export async function GET() {
  const redisConfigured = isQueueConfigured();
  let redisLive = false;
  let workerConnected = false;

  if (redisConfigured) {
    const url = process.env.REDIS_URL!.trim();
    redisLive = await pingRedis(2_500);
    if (redisLive) {
      workerConnected = await hasRegisteredEmailWorker(url, 3_000);
    }
  }

  const ok = !redisConfigured || (redisLive && workerConnected);

  return NextResponse.json(
    {
      ok,
      ts: Date.now(),
      redisConfigured,
      redisLive,
      workerConnected,
      sendReady: ok,
    },
    { status: ok ? 200 : 503 },
  );
}
