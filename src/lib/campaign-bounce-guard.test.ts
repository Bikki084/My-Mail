import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  formatCampaignBouncePauseMessage,
  shouldPauseCampaignForBounceSpike,
} from "./campaign-bounce-guard-logic";

describe("campaign-bounce-guard", () => {
  it("does not pause below minimum attempts", () => {
    assert.equal(
      shouldPauseCampaignForBounceSpike(15, 3, { minAttempts: 20, maxRate: 0.05 }),
      false,
    );
  });

  it("pauses when bounce rate exceeds threshold", () => {
    assert.equal(
      shouldPauseCampaignForBounceSpike(18, 2, { minAttempts: 20, maxRate: 0.05 }),
      true,
    );
  });

  it("does not pause when bounce rate is low", () => {
    assert.equal(
      shouldPauseCampaignForBounceSpike(95, 2, { minAttempts: 20, maxRate: 0.05 }),
      false,
    );
  });

  it("formats pause message", () => {
    const msg = formatCampaignBouncePauseMessage(18, 2, 0.05);
    assert.match(msg, /bounce rate/i);
    assert.match(msg, /paused/i);
  });
});
