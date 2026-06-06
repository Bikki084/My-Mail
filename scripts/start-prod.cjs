/**
 * Production start: best-effort auto-migrate, then `next start`.
 * Mirrors dev startup so missing Supabase columns do not silently brick sends.
 */
"use strict";

const { spawn } = require("node:child_process");
const { applyPendingMigrations } = require("./lib/migrate-runner.cjs");

async function main() {
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

  const child = spawn(
    process.platform === "win32" ? "npx.cmd" : "npx",
    ["next", "start", "--hostname", "0.0.0.0", "--port", "3000"],
    { stdio: "inherit", cwd: process.cwd(), shell: process.platform === "win32" },
  );
  child.on("exit", (code) => process.exit(code ?? 0));
}

main();
