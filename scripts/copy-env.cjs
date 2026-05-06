/**
 * Creates .env.local from .env.example if missing (secrets stay local; never committed).
 */
"use strict";

const fs = require("node:fs");
const path = require("node:path");

const root = path.join(__dirname, "..");
const dest = path.join(root, ".env.local");
const src = path.join(root, ".env.example");

if (fs.existsSync(dest)) {
  console.log(
    "[setup:env] .env.local already exists — not overwriting. Edit it or delete it to recreate.",
  );
  process.exit(0);
}

if (!fs.existsSync(src)) {
  console.error("[setup:env] Missing .env.example in repo root.");
  process.exit(1);
}

fs.copyFileSync(src, dest);
console.log(
  "[setup:env] Created .env.local from .env.example — add your Supabase URL, keys, and SMTP secrets, then restart the dev server.",
);
