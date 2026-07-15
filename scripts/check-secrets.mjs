#!/usr/bin/env node
/**
 * Scan source files for likely hardcoded secrets.
 * Usage: npm run check:secrets
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { execSync } from "node:child_process";

const ROOT = process.cwd();

const SKIP_DIRS = new Set([
  "node_modules",
  ".next",
  ".next-staging",
  ".next-backup",
  "out",
  ".git",
  "dist",
  "coverage",
]);

const ALLOWLIST = new Set([
  ".env.example",
  "scripts/check-secrets.mjs",
  "supabase/migrations/20260506130000_rename_bootstrap_admin_email.sql",
  "supabase/migrations/20260420120000_fix_profiles_rls_recursion.sql",
  "supabase/bootstrap.sql",
]);

const PATTERNS = [
  { name: "Brevo API key", re: /xkeysib-[a-zA-Z0-9_-]{20,}/ },
  {
    name: "Supabase service role JWT",
    re: /eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9\.[a-zA-Z0-9_-]+\.[a-zA-Z0-9_-]+/,
  },
  { name: "AWS access key", re: /\bAKIA[0-9A-Z]{16}\b/ },
  { name: "GitHub token", re: /\b(ghp_|github_pat_)[a-zA-Z0-9_]{20,}\b/ },
  { name: "Google OAuth secret", re: /\bGOCSPX-[a-zA-Z0-9_-]{20,}\b/ },
  {
    name: "Private key block",
    re: /-----BEGIN (RSA |OPENSSH |EC )?PRIVATE KEY-----/,
  },
  {
    name: "Hardcoded password assignment",
    re: /(?:password|passwd|secret)\s*=\s*['"][^'"\s]{8,}['"]/i,
  },
];

function listFiles(dir, out = []) {
  for (const name of readdirSync(dir)) {
    const abs = join(dir, name);
    const rel = relative(ROOT, abs).replace(/\\/g, "/");
    if (SKIP_DIRS.has(name)) continue;
    const st = statSync(abs);
    if (st.isDirectory()) {
      listFiles(abs, out);
      continue;
    }
    if (!/\.(ts|tsx|js|mjs|cjs|json|sql|md|yaml|yml|env|example|sh|csv)$/i.test(name)) {
      continue;
    }
    out.push(rel);
  }
  return out;
}

function gitTracked(relPath) {
  try {
    execSync(`git ls-files --error-unmatch "${relPath}"`, { cwd: ROOT, stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

function scanFile(relPath) {
  if (ALLOWLIST.has(relPath)) return [];
  const text = readFileSync(join(ROOT, relPath), "utf8");
  const hits = [];
  const lines = text.split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    for (const p of PATTERNS) {
      if (!p.re.test(line)) continue;
      if (relPath.endsWith(".example") || line.includes("your-") || line.includes("xxxx")) continue;
      if (p.name === "Hardcoded password assignment") {
        if (/required|must|error|message|label|aria|validation|Passwords do not/i.test(line)) {
          continue;
        }
        if (/process\.env|input\.|parsed\.|next\.|errors\.|BOOTSTRAP_ADMIN_PASSWORD/.test(line)) {
          continue;
        }
      }
      hits.push({ name: p.name, line: i + 1, snippet: line.trim().slice(0, 120) });
    }
  }
  return hits;
}

function main() {
  const files = listFiles(ROOT);
  const findings = [];

  for (const file of files) {
    const hits = scanFile(file);
    if (hits.length) findings.push({ file, hits });
  }

  const trackedEnv = [".env", ".env.local", ".env.production"].filter((p) => gitTracked(p));

  console.log("=== Secret scan ===\n");

  if (trackedEnv.length) {
    console.error("FAIL: Sensitive env files are tracked by git:");
    for (const f of trackedEnv) console.error(`  - ${f}`);
    console.error("");
  }

  if (findings.length === 0 && trackedEnv.length === 0) {
    console.log("OK: No suspicious hardcoded secrets found in source files.");
    console.log("Reminder: keep real keys only in .env.local (gitignored).");
    process.exit(0);
  }

  for (const { file, hits } of findings) {
    console.log(file);
    for (const h of hits) {
      console.log(`  L${h.line} [${h.name}] ${h.snippet}`);
    }
    console.log("");
  }

  process.exit(trackedEnv.length > 0 || findings.length > 0 ? 1 : 0);
}

main();
