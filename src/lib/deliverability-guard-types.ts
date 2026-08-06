export type DeliverabilitySignal =
  | "spam_report"
  | "blocked"
  | "hard_bounce"
  | "soft_bounce"
  | "deferred"
  | "dropped"
  | "smtp_spam_reject"
  | "esp_account_risk";
