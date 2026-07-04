/**
 * Production start: load .env.local, verify build, auto-migrate, then `next start`.
 * Run directly under PM2: `script: "scripts/start-prod.cjs", interpreter: "node"`.
 */
"use strict";

const { existsSync } = require("node:fs");
const { join } = require("node:path");
const { spawn } = require("node:child_process");
const { loadProjectEnv } = require("./load-env.cjs");
const { applyPendingMigrations } = require("./lib/migrate-runner.cjs");

loadProjectEnv();

const BUILD_ID = join(process.cwd(), ".next", "BUILD_ID");
const NEXT_BIN = join(process.cwd(), "node_modules", "next", "dist", "bin", "next");

function fail(msg) {
  console.error(`[start] FATAL: ${msg}`);
  process.exit(1);
}

async function main() {
  if (!existsSync(BUILD_ID)) {
    fail(
      "No production build (.next/BUILD_ID missing). On the server run:\n" +
        "  cd ~/mymail && npm run build:prod && pm2 restart mymail-web",
    );
  }

  if (!existsSync(NEXT_BIN)) {
    fail("node_modules/next not found. Run: npm ci && npm run build:prod");
  }

  if (!process.env.NEXT_PUBLIC_SUPABASE_URL?.trim()) {
    console.warn(
      "[start] WARN: NEXT_PUBLIC_SUPABASE_URL is unset — check .env.local in project root.",
    );
  }

  try {
    const result = await applyPendingMigrations({
      cwd: process.cwd(),
      log: (s) => process.stdout.write(s),
    });
    if (result.mode === "skipped") {
      console.warn(`[start] ${result.reason}\n`);
    } else if (!result.ok) {
      console.warn(
        `[start] Auto-migrate could not finish: ${result.reason}\n` +
          "Paste supabase/essential-for-send.sql in the Supabase SQL Editor, or add " +
          "SUPABASE_ACCESS_TOKEN to .env.local and run npm run db:migrate.\n",
      );
    } else if (result.applied?.length > 0) {
      console.log(
        `[start] Auto-applied ${result.applied.length} migration(s): ${result.applied.join(", ")}\n`,
      );
    }
  } catch (err) {
    console.warn(
      `[start] Auto-migrate threw: ${err && err.message ? err.message : err}\n`,
    );
  }

  console.log("[start] launching next start on 0.0.0.0:3000 …");

  const child = spawn(
    process.execPath,
    [NEXT_BIN, "start", "--hostname", "0.0.0.0", "--port", "3000"],
    {
      stdio: "inherit",
      cwd: process.cwd(),
      env: process.env,
    },
  );

  child.on("error", (err) => {
    console.error("[start] failed to spawn next:", err.message);
    process.exit(1);
  });

  child.on("exit", (code, signal) => {
    if (signal) {
      console.error(`[start] next exited via signal ${signal}`);
      process.exit(1);
    }
    process.exit(code ?? 0);
  });

  process.on("SIGINT", () => child.kill("SIGINT"));
  process.on("SIGTERM", () => child.kill("SIGTERM"));
}

main().catch((err) => {
  console.error("[start] unhandled:", err instanceof Error ? err.message : err);
  process.exit(1);
});
