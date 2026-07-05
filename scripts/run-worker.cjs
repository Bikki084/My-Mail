/**
 * PM2 entry for the BullMQ email worker — loads .env.local then runs tsx.
 */
"use strict";

const { existsSync } = require("node:fs");
const { join } = require("node:path");
const { spawn } = require("node:child_process");
const { loadProjectEnv } = require("./load-env.cjs");

loadProjectEnv();

function fail(msg) {
  console.error(`[run-worker] FATAL: ${msg}`);
  process.exit(1);
}

if (!process.env.REDIS_URL?.trim()) {
  fail("REDIS_URL missing — add to .env.local (e.g. redis://127.0.0.1:6379)");
}
if (!process.env.SUPABASE_SERVICE_ROLE_KEY?.trim()) {
  fail("SUPABASE_SERVICE_ROLE_KEY missing in .env.local");
}
if (!process.env.SMTP_ENCRYPTION_KEY?.trim()) {
  fail("SMTP_ENCRYPTION_KEY missing in .env.local");
}

const workerScript = join(process.cwd(), "scripts", "email-worker.ts");
if (!existsSync(workerScript)) {
  fail(`Worker script not found: ${workerScript}`);
}

console.log("[run-worker] starting email worker (BullMQ)…");

const tsxBin = join(process.cwd(), "node_modules", "tsx", "dist", "cli.mjs");
const useTsxBin = existsSync(tsxBin);

const child = useTsxBin
  ? spawn(process.execPath, [tsxBin, workerScript], {
      stdio: "inherit",
      cwd: process.cwd(),
      env: process.env,
    })
  : spawn(process.platform === "win32" ? "npx.cmd" : "npx", ["tsx", workerScript], {
      stdio: "inherit",
      cwd: process.cwd(),
      env: process.env,
      shell: process.platform === "win32",
    });

child.on("error", (err) => {
  console.error("[run-worker] spawn failed:", err.message);
  process.exit(1);
});

child.on("exit", (code, signal) => {
  if (signal) {
    console.error(`[run-worker] exited via signal ${signal}`);
    process.exit(1);
  }
  process.exit(code ?? 0);
});

process.on("SIGINT", () => child.kill("SIGINT"));
process.on("SIGTERM", () => child.kill("SIGTERM"));
