#!/usr/bin/env npx tsx
/**
 * Generate DKIM keys + DNS TXT records for inbox authentication.
 *
 *   npx tsx scripts/generate-dkim-keys.ts mail.yourcompany.com
 *   npx tsx scripts/generate-dkim-keys.ts mail.yourcompany.com --selector mail
 */
import {
  buildDeliverabilityDnsBundle,
  dkimPrivateKeyForEnv,
} from "../src/lib/dns-deliverability";

function main(): void {
  const domain = process.argv[2]?.trim();
  const selectorIdx = process.argv.indexOf("--selector");
  const selector = selectorIdx >= 0 ? process.argv[selectorIdx + 1]?.trim() : "mail";

  if (!domain) {
    console.error("Usage: npx tsx scripts/generate-dkim-keys.ts <domain> [--selector mail]");
    process.exit(1);
  }

  const bundle = buildDeliverabilityDnsBundle({
    domain,
    dkimSelector: selector,
    generateDkim: true,
  });

  console.log("\n=== DNS TXT records (publish at your registrar) ===\n");
  for (const rec of bundle.records) {
    console.log(`Host: ${rec.host}`);
    console.log(`Value: ${rec.value}`);
    if (rec.note) console.log(`Note: ${rec.note}`);
    console.log("");
  }

  if (bundle.dkim) {
    console.log("=== Add to .env.local on the server ===\n");
    console.log(`DKIM_DOMAIN=${bundle.domain}`);
    console.log(`DKIM_KEY_SELECTOR=${bundle.dkim.selector}`);
    console.log(`DKIM_PRIVATE_KEY=${dkimPrivateKeyForEnv(bundle.dkim.privateKeyPem)}`);
    console.log("\nThen: npm run build && pm2 restart all\n");
  }
}

main();
