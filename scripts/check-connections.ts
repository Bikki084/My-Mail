/**
 * Pre-launch connectivity check (Supabase, Redis, worker env).
 * Usage: npx tsx scripts/check-connections.ts
 */
import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import net from "node:net";
import { URL } from "node:url";
import { createClient } from "@supabase/supabase-js";
import IORedis from "ioredis";
import { hasRegisteredEmailWorker } from "../src/lib/queue/worker-presence";

function loadEnvLocal(): void {
  for (const name of [".env.local", ".env"]) {
    const p = resolve(process.cwd(), name);
    if (!existsSync(p)) continue;
    for (const line of readFileSync(p, "utf8").split(/\r?\n/)) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;
      const eq = trimmed.indexOf("=");
      if (eq <= 0) continue;
      const key = trimmed.slice(0, eq).trim();
      let val = trimmed.slice(eq + 1).trim();
      if (
        (val.startsWith('"') && val.endsWith('"')) ||
        (val.startsWith("'") && val.endsWith("'"))
      ) {
        val = val.slice(1, -1);
      }
      if (process.env[key] == null) process.env[key] = val;
    }
  }
}

type Status = "ok" | "warn" | "fail";

function row(label: string, status: Status, detail: string) {
  const icon = status === "ok" ? "✓" : status === "warn" ? "!" : "✗";
  console.log(`  ${icon} ${label}: ${detail}`);
}

function isPlaceholderSupabase(url: string, key: string): boolean {
  if (!url.trim() || !key.trim()) return true;
  if (url.includes("your-project") || url.includes("example.supabase.co")) return true;
  if (key.includes("your-anon") || key.length < 80) return true;
  return false;
}

function tcpProbe(host: string, port: number, timeoutMs: number): Promise<boolean> {
  return new Promise((resolve) => {
    const sock = new net.Socket();
    let done = false;
    const finish = (ok: boolean) => {
      if (done) return;
      done = true;
      try {
        sock.destroy();
      } catch {
        /* ignore */
      }
      resolve(ok);
    };
    sock.setTimeout(timeoutMs);
    sock.once("connect", () => finish(true));
    sock.once("timeout", () => finish(false));
    sock.once("error", () => finish(false));
    try {
      sock.connect(port, host);
    } catch {
      finish(false);
    }
  });
}

async function main() {
  loadEnvLocal();
  console.log("\n=== Mail Sender — connection check ===\n");

  let failures = 0;
  let warnings = 0;

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim() ?? "";
  const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY?.trim() ?? "";
  const serviceRole = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim() ?? "";
  const redisUrl = process.env.REDIS_URL?.trim() ?? "";
  const smtpKey = process.env.SMTP_ENCRYPTION_KEY?.trim() ?? "";

  // --- Supabase env ---
  console.log("Supabase");
  if (isPlaceholderSupabase(url, anon)) {
    row("Auth (public)", "warn", "URL or anon key missing/placeholder — UI preview mode only");
    warnings++;
  } else {
    row("Auth (public)", "ok", `URL set (${new URL(url).hostname})`);
    try {
      const client = createClient(url, anon, {
        auth: { persistSession: false, autoRefreshToken: false },
      });
      const { error } = await client.from("profiles").select("id").limit(1);
      if (error) {
        row("REST API", "fail", error.message);
        failures++;
      } else {
        row("REST API", "ok", "profiles table reachable");
      }
    } catch (e) {
      row("REST API", "fail", e instanceof Error ? e.message : String(e));
      failures++;
    }
  }

  if (!serviceRole) {
    row("Service role", "warn", "SUPABASE_SERVICE_ROLE_KEY unset — worker/admin scripts need it");
    warnings++;
  } else if (serviceRole.includes("your-service")) {
    row("Service role", "fail", "placeholder value — update .env.local");
    failures++;
  } else if (url && !isPlaceholderSupabase(url, anon)) {
    try {
      const admin = createClient(url, serviceRole, {
        auth: { persistSession: false, autoRefreshToken: false },
      });
      const { error } = await admin.from("profiles").select("id").limit(1);
      if (error) {
        row("Service role API", "fail", error.message);
        failures++;
      } else {
        row("Service role API", "ok", "admin client can query DB");
      }
    } catch (e) {
      row("Service role API", "fail", e instanceof Error ? e.message : String(e));
      failures++;
    }
  }

  // --- SMTP encryption key (worker + SMTP decrypt) ---
  console.log("\nSMTP / worker env");
  if (!smtpKey || smtpKey.includes("replace-with")) {
    row("SMTP_ENCRYPTION_KEY", "fail", "missing or placeholder — required to decrypt SMTP passwords");
    failures++;
  } else {
    row("SMTP_ENCRYPTION_KEY", "ok", "set");
  }

  // --- Redis ---
  console.log("\nRedis / queue");
  if (!redisUrl) {
    row("REDIS_URL", "warn", "unset — sends run in-process (no BullMQ queue)");
    warnings++;
  } else {
    let host = "127.0.0.1";
    let port = 6379;
    try {
      const u = new URL(redisUrl);
      host = u.hostname || host;
      port = parseInt(u.port || "6379", 10);
    } catch {
      row("REDIS_URL", "fail", `could not parse: ${redisUrl}`);
      failures++;
    }
    if (redisUrl) {
      const tcpOk = await tcpProbe(host, port, 2000);
      if (!tcpOk) {
        row("TCP", "fail", `${host}:${port} not reachable — start Redis or unset REDIS_URL for sync sends`);
        failures++;
      } else {
        row("TCP", "ok", `${host}:${port} reachable`);
        const redis = new IORedis(redisUrl, {
          lazyConnect: true,
          maxRetriesPerRequest: 1,
          connectTimeout: 3000,
          commandTimeout: 3000,
          retryStrategy: () => null,
        });
        try {
          await redis.connect();
          const pong = await redis.ping();
          row("PING", pong === "PONG" ? "ok" : "fail", String(pong));
          if (pong !== "PONG") failures++;
        } catch (e) {
          row("PING", "fail", e instanceof Error ? e.message : String(e));
          failures++;
        } finally {
          redis.disconnect();
        }
      }
    }
  }

  // --- Data layer (service role) ---
  if (url && serviceRole && !serviceRole.includes("your-service") && !isPlaceholderSupabase(url, anon)) {
    console.log("\nDatabase tables");
    try {
      const admin = createClient(url, serviceRole, {
        auth: { persistSession: false, autoRefreshToken: false },
      });
      for (const table of ["smtp_servers", "campaigns", "credits"] as const) {
        const { count, error } = await admin
          .from(table)
          .select("*", { count: "exact", head: true });
        if (error) {
          row(table, "fail", error.message);
          failures++;
        } else {
          row(table, "ok", `${count ?? 0} row(s)`);
        }
      }
      const { count: smtpCount, error: smtpErr } = await admin
        .from("smtp_servers")
        .select("*", { count: "exact", head: true });
      if (smtpErr) {
        row("SMTP configured", "fail", smtpErr.message);
        failures++;
      } else if (!smtpCount) {
        row("SMTP configured", "warn", "no servers — add SMTP in admin before sending");
        warnings++;
      } else {
        row("SMTP configured", "ok", `${smtpCount} server(s) in DB`);
      }
    } catch (e) {
      row("Database tables", "fail", e instanceof Error ? e.message : String(e));
      failures++;
    }
  }

  // --- Chromium (HTML → PDF/image attachments) ---
  console.log("\nHTML attachments (Puppeteer / Chromium)");
  const chromiumCandidates = [
    process.env.PUPPETEER_EXECUTABLE_PATH?.trim(),
    "/usr/bin/chromium-browser",
    "/usr/bin/chromium",
  ].filter((p): p is string => Boolean(p?.trim()));
  const chromiumPath = chromiumCandidates.find((p) => existsSync(p));
  if (chromiumPath) {
    row("Chromium binary", "ok", chromiumPath);
  } else if (process.platform === "linux") {
    row(
      "Chromium binary",
      "warn",
      "not found — PDF/image attachments need: sudo bash scripts/install-chromium-deps.sh",
    );
    warnings++;
  } else {
    row("Chromium binary", "ok", "using Puppeteer bundled Chrome (Windows/macOS dev)");
  }

  // --- Worker readiness ---
  console.log("\nEmail worker (npm run worker / auto with npm run dev)");
  const workerReady =
    Boolean(redisUrl) &&
    Boolean(serviceRole) &&
    Boolean(smtpKey) &&
    !smtpKey.includes("replace-with") &&
    Boolean(url);
  if (!redisUrl) {
    row("Worker", "warn", "skipped — no REDIS_URL");
    warnings++;
  } else if (!workerReady) {
    row("Worker env", "fail", "REDIS_URL set but missing service role, Supabase URL, or SMTP key");
    failures++;
  } else {
    row("Worker env", "ok", "REDIS_URL + service role + SMTP key present");
    const tcpTarget = (() => {
      try {
        const u = new URL(redisUrl);
        return { host: u.hostname || "127.0.0.1", port: parseInt(u.port || "6379", 10) };
      } catch {
        return null;
      }
    })();
    if (tcpTarget && !(await tcpProbe(tcpTarget.host, tcpTarget.port, 2000))) {
      row("Worker can start", "fail", "Redis down — run worker after Redis is up");
      failures++;
    } else {
      row("Worker can start", "ok", "run `npm run dev` (starts worker if Redis up) or `npm run worker`");
      const workerLive = await hasRegisteredEmailWorker(redisUrl, 2500);
      if (workerLive) {
        row("Worker connected", "ok", "BullMQ worker registered in Redis");
      } else {
        row(
          "Worker connected",
          "warn",
          "no worker in Redis — start `npm run worker` or PM2 mymail-worker (small sends still work in-process)",
        );
        warnings++;
      }
    }
  }

  console.log("\n--- Summary ---");
  if (failures === 0 && warnings === 0) {
    console.log("All checks passed. Safe to launch with `npm run dev`.\n");
    process.exit(0);
  }
  if (failures === 0) {
    console.log(`${warnings} warning(s), 0 failures. App can start; some features limited.\n`);
    process.exit(0);
  }
  console.log(`${failures} failure(s), ${warnings} warning(s). Fix .env.local / services before sending mail.\n`);
  process.exit(1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
