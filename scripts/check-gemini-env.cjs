#!/usr/bin/env node
"use strict";

/**
 * Verify GEMINI_API_KEY is loaded from .env.local (no API call).
 * Usage: node scripts/check-gemini-env.cjs
 */
const { loadProjectEnv } = require("./load-env.cjs");

loadProjectEnv();

const key = (process.env.GEMINI_API_KEY || process.env.GOOGLE_GENERATIVE_AI_API_KEY || "").trim();

if (!key) {
  console.error("FAIL: GEMINI_API_KEY not found in .env.local");
  console.error("  Add: GEMINI_API_KEY=your-key-here");
  console.error("  File: ~/mymail/.env.local");
  process.exit(1);
}

console.log(`OK: GEMINI_API_KEY loaded (${key.length} chars, ends …${key.slice(-4)})`);
console.log("Next: npx tsx scripts/check-gemini-key.ts");
