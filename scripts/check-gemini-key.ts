/**
 * Quick Gemini connectivity check — prints whether the API key works.
 * Usage: npx tsx scripts/check-gemini-key.ts
 */
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
require("./load-env.cjs").loadProjectEnv();

require("module").Module._cache[require.resolve("server-only")] = {
  exports: {},
  loaded: true,
};

// eslint-disable-next-line @typescript-eslint/no-require-imports
const {
  resolveGeminiApiKey,
  resolveGeminiModelCandidates,
  generateGeminiJsonText,
} = require("../src/lib/gemini/client");

async function main() {
  const key = resolveGeminiApiKey();
  if (!key) {
    console.error("FAIL: GEMINI_API_KEY not loaded from .env.local");
    console.error("  cd ~/mymail && grep GEMINI_API_KEY .env.local");
    process.exit(1);
  }

  console.log(`Key loaded: yes (${key.length} chars, ends …${key.slice(-4)})`);
  console.log(`Models to try: ${resolveGeminiModelCandidates().join(", ")}`);

  const result = await generateGeminiJsonText(
    'Reply with JSON only: {"status":"ok","message":"hello"}',
  );

  if (result.ok) {
    console.log("SUCCESS: Gemini responded.");
    console.log(`Model: ${result.model}`);
    console.log(`Response: ${result.text.slice(0, 300)}`);
    return;
  }

  console.error("FAIL: Gemini API error:");
  console.error(result.reason);
  process.exit(1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
