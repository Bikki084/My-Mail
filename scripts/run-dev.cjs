/**
 * Dev entry: runs `next dev`, and if REDIS_URL is set in `.env.local` / `.env`
 * AND Redis is actually reachable, also starts the BullMQ email worker so
 * queued sends are processed without a second terminal.
 *
 * If REDIS_URL is set but the host is not reachable (no Docker, port closed,
 * etc.) we deliberately do NOT spawn the worker — it would just spam
 * ECONNREFUSED. The /api/campaigns/:id/send route detects the same condition
 * at runtime and falls back to in-process delivery, so sends still succeed.
 *
 * Escape hatch (Next only): npm run dev:next
 */
"use strict";

const { spawn } = require("node:child_process");
const fs = require("node:fs");
const net = require("node:net");
const path = require("node:path");
const { URL } = require("node:url");
const { applyPendingMigrations } = require("./lib/migrate-runner.cjs");

function loadEnvFromProjectFiles() {
  for (const name of [".env.local", ".env"]) {
    const p = path.join(process.cwd(), name);
    if (!fs.existsSync(p)) continue;
    for (const line of fs.readFileSync(p, "utf8").split(/\r?\n/)) {
      const m = /^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/.exec(line);
      if (!m) continue;
      let v = m[2].trim();
    if (
      (v.startsWith('"') && v.endsWith('"')) ||
      (v.startsWith("'") && v.endsWith("'"))
    ) {
      v = v.slice(1, -1);
    }
    if (name === ".env.local") {
      process.env[m[1]] = v;
    } else if (process.env[m[1]] == null) {
      process.env[m[1]] = v;
    }
    }
  }
}

/** Best-effort TCP connect to host:port with a short budget. */
function tcpProbe(host, port, timeoutMs) {
  return new Promise((resolve) => {
    const sock = new net.Socket();
    let done = false;
    const finish = (ok) => {
      if (done) return;
      done = true;
      try {
        sock.destroy();
      } catch (_) {
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
    } catch (_) {
      finish(false);
    }
  });
}

function parseRedisUrl(raw) {
  try {
    const u = new URL(raw);
    const host = u.hostname || "127.0.0.1";
    const port = parseInt(u.port || "6379", 10);
    return { host, port };
  } catch (_) {
    return null;
  }
}

async function autoMigrate() {
  // Best-effort: never block dev startup. The previous failure mode here was
  // that a forgotten `npm run db:migrate` after `git pull` left the campaigns
  // table missing newer columns, which made every send silently die in the
  // background while the UI still showed "Send started" — a green tick with
  // no email. Auto-applying pending SQL from supabase/migrations on startup
  // (tracked in `_mymail_migrations`) closes that gap permanently.
  try {
    const result = await applyPendingMigrations({ cwd: process.cwd() });
    if (!result.ok) {
      console.warn(
        `\n[dev] Auto-migrate could not run: ${result.reason}\n` +
          (result.applied?.length
            ? `[dev]   applied: ${result.applied.join(", ")}\n`
            : "") +
          (result.remaining?.length
            ? `[dev]   remaining: ${result.remaining.join(", ")}\n`
            : ""),
      );
      return;
    }
    if (result.mode === "skipped") {
      console.log(`\n[dev] ${result.reason}\n`);
      return;
    }
    if (result.applied && result.applied.length > 0) {
      console.log(
        `\n[dev] Auto-applied ${result.applied.length} new migration(s): ${result.applied.join(", ")}\n`,
      );
    }
  } catch (err) {
    // Network blip / unexpected error — surface but don't crash.
    console.warn(
      `\n[dev] Auto-migrate threw: ${err && err.message ? err.message : err}\n`,
    );
  }
}

async function main() {
  loadEnvFromProjectFiles();
  await autoMigrate();
  const redisUrl = String(process.env.REDIS_URL || "").trim();
  const useShell = process.platform === "win32";

  let redisLive = false;
  if (redisUrl) {
    const target = parseRedisUrl(redisUrl);
    if (!target) {
      console.log(
        `\n[dev] REDIS_URL is set but could not be parsed (${redisUrl}); skipping the email worker. Sends will run in-process.\n`,
      );
    } else {
      redisLive = await tcpProbe(target.host, target.port, 1500);
      if (!redisLive) {
        console.log(
          `\n[dev] REDIS_URL is set (${target.host}:${target.port}) but Redis is not reachable — skipping the email worker. ` +
            `Sends will run in-process automatically; for the queue, start Redis (e.g. \`docker run -d -p 6379:6379 redis:7\`) and restart \`npm run dev\`.\n`,
        );
      }
    }
  } else {
    console.log(
      "\n[dev] No REDIS_URL — worker not started (sends run in-process; add REDIS_URL to .env.local once Redis is up to enable the queue).\n",
    );
  }

  const next = spawn("npx", ["next", "dev"], {
    stdio: "inherit",
    shell: useShell,
    env: process.env,
  });

  let worker = null;
  if (redisLive) {
    console.log(
      "\n[dev] REDIS_URL is set and reachable — starting the email worker with Next.js (queued sends).\n",
    );
    worker = spawn("npx", ["tsx", "scripts/email-worker.ts"], {
      stdio: "inherit",
      shell: useShell,
      env: process.env,
    });
  }

  function shutdown(code) {
    try {
      next.kill("SIGTERM");
    } catch (_) {
      /* ignore */
    }
    try {
      if (worker) worker.kill("SIGTERM");
    } catch (_) {
      /* ignore */
    }
    process.exit(code);
  }

  process.on("SIGINT", () => shutdown(0));
  process.on("SIGTERM", () => shutdown(0));

  next.on("exit", (code, signal) => {
    try {
      if (worker) worker.kill("SIGTERM");
    } catch (_) {
      /* ignore */
    }
    process.exit(code ?? (signal ? 1 : 0));
  });

  if (worker) {
    worker.on("exit", (code) => {
      if (code !== 0 && code != null) {
        console.error(
          `\n[dev] Email worker exited with code ${code}. Queued jobs will not run until it is healthy. Restart \`npm run dev\` or run \`npm run worker\` in another terminal.\n`,
        );
      }
    });
  }
}

main().catch((err) => {
  console.error("[dev] Failed to start:", err);
  process.exit(1);
});
