import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { evaluateTrustTierTransition } from "./evaluate";

const baseProfile = {
  trustTier: "new" as const,
  trustDailySendLimit: 30,
  createdAt: new Date(Date.now() - 10 * 24 * 60 * 60 * 1000).toISOString(),
  trustTierUpdatedAt: new Date(Date.now() - 5 * 24 * 60 * 60 * 1000).toISOString(),
};

const goodMetrics = {
  bounceRate: 0.005,
  complaintRate: 0.0001,
  sentCount: 500,
  bouncedCount: 2,
  complaintCount: 0,
};

describe("trust-tier evaluate", () => {
  it("upgrades new account after initial period with good metrics", () => {
    const r = evaluateTrustTierTransition(
      {
        ...baseProfile,
        trustTier: "new",
        createdAt: new Date(Date.now() - 5 * 24 * 60 * 60 * 1000).toISOString(),
      },
      goodMetrics,
    );
    assert.equal(r.tier, "warming");
    assert.ok(r.dailyLimit > 30);
    assert.equal(r.changed, true);
  });

  it("demotes to restricted on severe metrics", () => {
    const r = evaluateTrustTierTransition(
      {
        ...baseProfile,
        trustTier: "established",
        trustDailySendLimit: 50_000,
      },
      {
        bounceRate: 0.08,
        complaintRate: 0.001,
        sentCount: 100,
        bouncedCount: 8,
        complaintCount: 0,
      },
    );
    assert.equal(r.tier, "restricted");
    assert.equal(r.changed, true);
  });

  it("demotes established to warming on moderate bad metrics", () => {
    const r = evaluateTrustTierTransition(
      {
        ...baseProfile,
        trustTier: "established",
        trustDailySendLimit: 50_000,
      },
      {
        bounceRate: 0.03,
        complaintRate: 0.0001,
        sentCount: 200,
        bouncedCount: 6,
        complaintCount: 0,
      },
    );
    assert.equal(r.tier, "warming");
    assert.ok(r.dailyLimit < 50_000);
  });

  it("keeps new tier during initial period", () => {
    const r = evaluateTrustTierTransition(
      {
        ...baseProfile,
        trustTier: "new",
        createdAt: new Date(Date.now() - 1 * 24 * 60 * 60 * 1000).toISOString(),
      },
      goodMetrics,
    );
    assert.equal(r.tier, "new");
    assert.equal(r.dailyLimit, 30);
  });
});
