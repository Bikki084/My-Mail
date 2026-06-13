import crypto from "node:crypto";

export type DnsRecord = {
  type: "TXT";
  host: string;
  value: string;
  note?: string;
};

export type DkimKeyPair = {
  selector: string;
  domain: string;
  privateKeyPem: string;
  publicKeyPem: string;
  dnsHost: string;
  dnsValue: string;
};

export type DeliverabilityDnsBundle = {
  domain: string;
  dkim: DkimKeyPair | null;
  records: DnsRecord[];
};

function normalizeDomain(raw: string): string {
  return raw.trim().toLowerCase().replace(/\.$/, "");
}

/** Strip PEM headers and whitespace for DNS TXT `p=` value. */
export function dkimPublicKeyForDns(publicKeyPem: string): string {
  return publicKeyPem
    .replace(/-----BEGIN PUBLIC KEY-----/g, "")
    .replace(/-----END PUBLIC KEY-----/g, "")
    .replace(/\s+/g, "");
}

export function generateDkimKeyPair(
  domain: string,
  selector = "mail",
): DkimKeyPair {
  const normalized = normalizeDomain(domain);
  if (!normalized || normalized.includes("@")) {
    throw new Error("Enter a valid domain (e.g. mail.yourcompany.com).");
  }
  const sel = selector.trim() || "mail";
  const { publicKey, privateKey } = crypto.generateKeyPairSync("rsa", {
    modulusLength: 2048,
    publicKeyEncoding: { type: "spki", format: "pem" },
    privateKeyEncoding: { type: "pkcs8", format: "pem" },
  });
  const dnsHost = `${sel}._domainkey.${normalized}`;
  const dnsValue = `v=DKIM1; k=rsa; p=${dkimPublicKeyForDns(publicKey)}`;
  return {
    selector: sel,
    domain: normalized,
    privateKeyPem: privateKey,
    publicKeyPem: publicKey,
    dnsHost,
    dnsValue,
  };
}

export function buildSpfRecord(args: {
  domain: string;
  ipv4?: string[];
  include?: string[];
}): DnsRecord {
  const domain = normalizeDomain(args.domain);
  const parts = ["v=spf1"];
  for (const ip of args.ipv4 ?? []) {
    const trimmed = ip.trim();
    if (trimmed) parts.push(`ip4:${trimmed}`);
  }
  for (const inc of args.include ?? []) {
    const trimmed = inc.trim();
    if (trimmed) parts.push(`include:${trimmed}`);
  }
  if (parts.length === 1) {
    parts.push("a", "mx");
  }
  parts.push("~all");
  return {
    type: "TXT",
    host: domain,
    value: parts.join(" "),
    note: "Publish at the root of your sending domain. Use -all (strict) once tested.",
  };
}

export function buildDmarcRecord(args: {
  domain: string;
  reportEmail?: string | null;
  policy?: "none" | "quarantine" | "reject";
}): DnsRecord {
  const domain = normalizeDomain(args.domain);
  const email = (args.reportEmail ?? `dmarc@${domain}`).trim();
  const policy = args.policy ?? "quarantine";
  return {
    type: "TXT",
    host: `_dmarc.${domain}`,
    value: `v=DMARC1; p=${policy}; adkim=s; aspf=s; rua=mailto:${email}; pct=100`,
    note: "Start with p=none while testing, then quarantine, then reject.",
  };
}

export function buildDeliverabilityDnsBundle(args: {
  domain: string;
  sendingIpv4?: string[];
  smtpInclude?: string[];
  dmarcReportEmail?: string | null;
  dkimSelector?: string;
  generateDkim?: boolean;
}): DeliverabilityDnsBundle {
  const domain = normalizeDomain(args.domain);
  if (!domain) throw new Error("Domain is required.");

  let dkim: DkimKeyPair | null = null;
  if (args.generateDkim !== false) {
    dkim = generateDkimKeyPair(domain, args.dkimSelector ?? "mail");
  }

  const records: DnsRecord[] = [
    buildSpfRecord({
      domain,
      ipv4: args.sendingIpv4,
      include: args.smtpInclude,
    }),
  ];

  if (dkim) {
    records.push({
      type: "TXT",
      host: dkim.dnsHost,
      value: dkim.dnsValue,
      note: "DKIM public key — must match the private key in DKIM_PRIVATE_KEY on the server.",
    });
  }

  records.push(
    buildDmarcRecord({
      domain,
      reportEmail: args.dmarcReportEmail,
      policy: "quarantine",
    }),
  );

  return { domain, dkim, records };
}

/** One-line private key for .env.local (escaped newlines). */
export function dkimPrivateKeyForEnv(privateKeyPem: string): string {
  return JSON.stringify(privateKeyPem.trim());
}
