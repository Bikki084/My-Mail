# Mailshooter — Project Brain

> **Purpose:** Single source of truth for AI agents and developers. Read this file **before** scanning the whole repo.  
> **Maintainers:** Update this file whenever you add features, change limits, deploy steps, or infra — same as you would commit code.  
> **Last updated:** 2026-08-16

---

## Changelog (recent)

| 2026-08-16 | **nginx cutover:** strip duplicate `gzip_vary` so mailshooter.in HTTPS setup can reload |
| 2026-08-16 | **Domain cutover:** site + sending → `mailshooter.in` / Mailshooter; script `setup-mailshooter-lightsail.sh` |
| 2026-08-13 | **Brand lock:** canonical display name is `Bulkfirepro` (`APP_BRAND_NAME`); `BulkProFire` is the wrong letter-order and is rewritten; UI/sender/generate/verify share one constant |
| 2026-08-13 | **Gemini generate:** Flash-Lite first + 429 fallback; human quota errors; no fake invoice fields for simple-mail briefs; retry unparseable JSON |
| 2026-08-13 | **Verification persistence:** content-hash-keyed DB + localStorage; survives tab switch; distinct Not yet verified / Passed / Failed UI |
| 2026-08-13 | **Phishing validator rebuild:** mandatory Gemini 2.5 Flash pass/fail gate (subject+body+attachment); no default PASS on error; Manual vs AI-Generate compose modes; blank default compose |
| 2026-08-12 | **Blocking consistency gate:** final body vs attachment field check on every verify/apply; literals (not merge tags) for invoice/TXN/date; Apply re-verifies applied content |
| 2026-08-12 | **Gemini models:** default `gemini-2.5-flash`; auto-remap retired `gemini-2.0-flash`; 404 fallbacks + thinkingBudget=0 (fix content verification 404) |
| 2026-08-06 | **Favicon:** tab + Apple touch icons match header logo (emerald→teal mail mark) via `src/app/icon.svg` + `apple-icon.tsx` |
| 2026-08-06 | **Domain cutover:** production app switched back to `bulkfirepro.com` (from `bulkprofire.com`) |
| 2026-08-06 | **AI merge tags:** Gemini spam-free / genuineness rewrites personalize with CSV + built-in tags (`{{{name}}}`, `{{{email}}}`, …) |
| 2026-08-05 | **Content spam review:** local heuristics + Gemini AI subject/body rewrite suggestions in Email Composer |
| 2026-08-05 | **Deliverability guard:** auto-pause all sends ~7h on spam report/block/bounce spikes (Redis + Event Webhook) |
| 2026-08-05 | **Mandatory compose fields:** sender name, subject, and HTML body required to send; attachment-only campaigns blocked (client + API + delivery) |
| 2026-08-03 | Fix admin per-client email counts capped at 1000 Supabase rows |
| 2026-08-03 | **AWS env:** `SENDGRID_EMAIL_PLAN_LIMIT` must be `50000` for Essentials 50K (not `5000`) or omit for auto-detect |
| 2026-08-03 | **Bounce prevention:** CSV validation (syntax, disposable, MX, role addresses), suppression at send, provider-agnostic webhook `/api/webhooks/email-events` |
| 2026-07-30 | **User Activity** admin section (`/admin/user-activity`), 2-day retention, PDF preview via API |
| 2026-07 | SendGrid/Mailjet From-address fixes; brand → `bulkprofire.com` / BulkProFire |

---

## Product at a glance

| Item | Value |
|------|--------|
| **Brand** | Mailshooter (`APP_BRAND_NAME` in `src/lib/brand.ts`) |
| **Domain** | `mailshooter.in` |
| **Repo** | GitHub `Bikki084/My-Mail` |
| **Stack** | Next.js 16 App Router, React 19, Tailwind v4, Supabase, BullMQ + Redis, Nodemailer |
| **Production host** | AWS Lightsail (Mumbai), nginx → PM2 |
| **Primary relay** | SendGrid (Twilio) — `smtp.sendgrid.net:587`, user `apikey` |

Brand constants: `src/lib/brand.ts`

---

## Production server

```bash
# SSH → app directory
cd ~/mymail

# Domain cutover (mailshooter.in)
git pull && bash scripts/setup-mailshooter-lightsail.sh
# Or HTTPS-only: sudo BULK_DOMAIN=mailshooter.in bash scripts/setup-https.sh && bash scripts/deploy-production.sh

# Deploy (pull + build + PM2 reload)
git pull && bash scripts/deploy-production.sh

# DB migrations (after pull)
npm run db:migrate

# Health check
curl -sf https://mailshooter.in/api/health

# PM2
pm2 status
pm2 logs mymail-web --lines 40
pm2 logs mymail-worker --lines 40

# Stack (Redis + web + worker)
bash scripts/ensure-email-stack.sh
```

**Processes (PM2):** `mymail-web`, `mymail-worker` — see `ecosystem.config.cjs`

**Reliability:** `scripts/site-watchdog.sh` (cron every minute), hourly user-activity purge stamp

### AWS Lightsail — `.env.local` (SendGrid)

Edit on server: `nano ~/mymail/.env.local`

| Variable | What to set | Notes |
|----------|-------------|--------|
| `SENDGRID_API_KEY` | `SG.xxxx...` | Same key as SMTP password when username is `apikey`. Needs **Read** scope for dashboard quota. |
| `SENDGRID_EMAIL_PLAN_LIMIT` | **`50000`** or **remove line** | Essentials **50K** = 50,000 emails/month. **Do not use `5000`** — that is wrong for your plan. If omitted, app auto-detects 50K from API (500000 ÷ 10). |
| `BREVO_API_KEY` | **Remove** | Legacy; dashboard uses SendGrid only. |

After editing env:

```bash
cd ~/mymail && git pull && bash scripts/deploy-production.sh
pm2 restart mymail-web mymail-worker --update-env
```

Verify admin dashboard → SendGrid quota shows **~50,000** limit and used count close to SendGrid UI.

---

## Architecture

```
Browser → nginx → Next.js (mymail-web)
                      │
                      ├─ /admin/*  (role=admin)
                      ├─ /client/* (role=client)
                      └─ /api/*    (campaigns, health, …)
                              │
                              ▼ enqueue (BullMQ)
                         Redis ──► mymail-worker
                              │
                              ▼
                    runSendCampaign() → deliverCampaignInParallel()
                              │
                              ▼
                         SMTP (SendGrid, etc.) → recipients
                              │
                              ▼
                         Supabase (campaigns, sending_logs, …)
```

**Auth:** Supabase SSR cookies; role from `profiles.role` in middleware (`src/lib/supabase/middleware.ts`).

**Admin actions:** Server Actions in `src/app/admin/**/actions.ts` + `assertAdmin()` pattern — not `/api/admin/*` except user-activity attachment stream.

---

## Bounce prevention (provider-agnostic)

Works with **any SMTP** — not tied to SendGrid APIs for validation.

| Layer | What it does |
|-------|----------------|
| **CSV upload** | `POST /api/recipients/validate` — syntax, disposable domains, DNS MX, role addresses, tenant suppression |
| **Campaign create** | Server re-filters recipients (`filterRecipientsForSend`) before storing |
| **Send loop** | Skips suppressed + validation-failed addresses; logs reason in `sending_logs` |
| **Webhook** | `POST /api/webhooks/email-events` — hard bounces, blocks, spam → auto-suppress in `unsubscribes` |

**SendGrid Event Webhook setup:**

1. SendGrid → Settings → Mail Settings → Event Webhook  
2. URL: `https://mailshooter.in/api/webhooks/email-events`  
3. Events: **Bounce**, **Blocked**, **Spam Report**, **Dropped**  
4. Optional header: `X-Webhook-Secret: <EMAIL_WEBHOOK_SECRET>` (set same value in `.env.local`)  
5. Optional header: `X-Webhook-Provider: sendgrid`

Outbound sends attach `X-Mymail-Campaign-Id` / `X-Mymail-User-Id` (all providers) and SendGrid `unique_args` for webhook correlation.

**Migration:** `20260803120000_recipient_bounce_prevention.sql`

**Code:** `src/lib/recipient-validation/`, `src/lib/recipient-suppression.ts`, `src/lib/webhooks/`

---

## Campaign compose requirements (anti-spam)

To reduce attachment-only spam patterns that trigger ESP suspensions:

| Field | Required | Notes |
|-------|----------|--------|
| **Sender name** | Yes | Non-empty after trim |
| **Subject** | Yes | Non-empty after trim |
| **Email body (HTML)** | Yes | Must contain readable text (not empty tags) |
| Attachments (PDF/PNG/file) | No | Optional |
| HTML attachment (generated PDF/image) | No | Optional — still requires main body |

Enforced in: `src/lib/campaign-compose-validation.ts`, Zod schema `campaignFieldsSchema`, Email Composer UI, `POST /api/campaigns`, and the send worker (no auto “see attached file” placeholder).

---

## Deliverability guard (auto-pause / freeze)

**Important:** No ESP reports silent spam-folder placement. SendGrid “delivered” only means the recipient server accepted the message — not inbox vs spam. The guard uses the **earliest available reputation signals** and **freezes all sending for 7 hours** before SendGrid can suspend the account:

| Signal | Source | Default threshold (60 min window) |
|--------|--------|-----------------------------------|
| Spam report | Event Webhook | **1** |
| ESP account risk | SMTP errors (suspended, disabled) | **1** |
| Blocked | Event Webhook | **2** |
| Hard bounce | Webhook + SMTP errors | **5** |
| SMTP spam reject | Send failure text (550/554/spam) | **2** |
| Dropped / deferred | Event Webhook | **3** / **15** |

**Composite score:** weighted sum of all signals in the window (spam=10, esp risk=15, block=6, …). Trips at **12** points by default — catches mixed bad signals early.

When tripped → **all sends frozen** for `DELIVERABILITY_PAUSE_HOURS` (default **7**). Active campaigns → `paused` with `pause_reason=deliverability_guard`. Resume blocked until cooldown ends.

**Bounce spike → platform freeze:** campaign hard-bounce rate ≥5% also triggers the same 7h platform freeze (not just campaign pause).

**Enforced at:** send API, resume API, campaign create (send intent), worker mid-send (`shouldAbort` every 1s), webhook handler.

**Requires:** SendGrid Event Webhook (`/api/webhooks/email-events`) + **Redis** on production (shared state across web + worker).

**Status API:** `GET /api/deliverability/pause-status`

**Code:** `src/lib/deliverability-guard.ts`, `src/lib/deliverability-guard-logic.ts`

**Env:** `DELIVERABILITY_PAUSE_HOURS`, `DELIVERABILITY_GUARD_DISABLE=1` to turn off, `DELIVERABILITY_COMPOSITE_THRESHOLD`, `DELIVERABILITY_*_THRESHOLD`

---

## Content spam review (AI + rules)

Pre-send coach in **Email Composer → Verify content**:

| Layer | What it does |
|-------|----------------|
| **Local heuristics** | Instant score 0–100: caps, spam phrases, thin body, attachment-only pitch, link count |
| **Genuineness gate** | Hard pass/fail on subject quality, body specificity, subject↔body alignment, attachment text, body↔attachment relevance |
| **Gemini AI** (optional) | Grounded rewrite of subject + HTML + attachment HTML from one **canonical fields** object (invoice/TXN/date/company/support); consistency validator blocks mismatched IDs; personalizes with CSV merge tags; never auto-approved |

**API:** `POST /api/campaigns/content-review` (authenticated)

**Requires send:** Message must **pass genuineness review** for the current content fingerprint. Send button stays **disabled** until pass. Pass is bound to a short-lived HMAC token (`X-Mymail-Genuineness-Token`) verified again on create+send. Any edit invalidates the pass.

**Server block:** `runGenuinenessPassGuard` + existing `runContentSpamRiskGuard` on create (send intent) and send API.

**Rescore limit:** fingerprint-based rate limit on repeated checks (`CONTENT_RESCORE_MAX_ATTEMPTS`, `CONTENT_RESCORE_WINDOW_MINUTES`).

**Audit:** `content_genuineness_audit` (pass/fail, categories, AI suggested/accepted). Migration: `20260806140000_content_genuineness_audit.sql`

**Code:** `src/lib/content-genuineness/`, `src/lib/content-spam-review/`

**Env:** `CONTENT_GENUINENESS_GATE_DISABLE`, `GENUINENESS_*`, `GEMINI_API_KEY`

---

## Content spam review (legacy heuristics notes)

**Heuristics added:** fake Re:/Fwd: subjects, hidden HTML, image-heavy bodies, phishing phrases, URL shorteners, subject length.

**Free AI key:** [Google AI Studio](https://aistudio.google.com/apikey) → `GEMINI_API_KEY` in `.env.local`

**Env:** `GEMINI_API_KEY`, optional `GEMINI_CONTENT_REVIEW_MODEL` (default `gemini-2.5-flash`; retired `gemini-2.0-flash` remapped), `CONTENT_SPAM_BLOCK_*`

---

## Trust tiers (client send caps)

Progressive daily send limits per client before mail hits the ESP queue:

| Tier | Default daily cap | How reached |
|------|-------------------|-------------|
| **new** | 30 | Default for new accounts (first 4 days) |
| **warming** | doubles every 3 days | After new period, if metrics OK |
| **established** | 50,000 | Sustained good bounce/complaint rates |
| **restricted** | 5 | Bounce/complaint thresholds exceeded |

Metrics from webhook + send logs (30-day lookback). Tier changes logged in `client_trust_tier_history`.

**Enforced at:** campaign create, send, content review — via `src/lib/campaign-send-guards.ts` + `src/lib/trust-tier/service.ts`

**Client API:** `GET /api/account/trust-tier`

**Admin:** `/admin/trust-tiers` — view/adjust tiers

**Migration:** `20260805120000_trust_tier_and_anti_spam_audit.sql` (adds `profiles.trust_tier`, audit tables)

**Code:** `src/lib/trust-tier/`, `src/lib/anti-spam-config.ts`

**Env:** `TRUST_TIER_*` — see `.env.example`

---

## Content quality & attachment security

Hard blocks at campaign create/send (logged to audit tables):

| Check | What it blocks |
|-------|----------------|
| **Min word count** | Thin HTML body (default 25 words) |
| **Text vs attachment ratio** | Large attachments with little body text |
| **Attachment types** | Dangerous extensions / MIME mismatches (`.exe`, `.js`, etc.) |
| **Rescore gaming** | Too many spam-risk rescoring attempts on same content |

**Audit tables:** `content_rejection_audit`, `attachment_block_audit`, `content_rescore_audit`

**Code:** `src/lib/content-quality-validation.ts`, `src/lib/attachment-security.ts`, `src/lib/anti-spam-audit.ts`

**Env:** `CONTENT_MIN_WORD_COUNT`, `CONTENT_MIN_TEXT_CHARS_PER_ATTACHMENT_KB`, `CONTENT_RESCORE_*`

---

## Directory map (high signal)

```
src/
  app/
    admin/          Admin console pages
    client/         Client console pages
    api/            REST handlers (campaigns, health, auth, …)
    actions/        Shared server actions
  components/
    admin/          AdminShell, quota panels, page headers
    client/         Campaign composer, SMTP, deliverability
  lib/
    brand.ts        Domain / product name
    campaign-delivery.ts          Send orchestration
    campaign-delivery-parallel.ts  Parallel SMTP workers
    send-governor.ts              Concurrency caps (Redis)
    queue/                        BullMQ email queue
    sendgrid/account.ts           SendGrid quota API
    user-activity-capture.ts      Admin activity snapshots
    smtp/from-address.ts          From header for relays
    validation/                   Zod schemas
scripts/
  email-worker.ts   BullMQ consumer
  deploy-production.sh
  purge-user-activity.ts
supabase/migrations/  SQL migrations (run via npm run db:migrate)
ecosystem.config.cjs  PM2 production env defaults
```

---

## Admin console routes

| Route | Purpose |
|-------|---------|
| `/admin` | Dashboard stats + **SendGrid quota** panel |
| `/admin/users` | Client user CRUD |
| `/admin/credits/top-up` | Credit assignment |
| `/admin/payment-notes` | Payment notes |
| `/admin/monitor` | Live sending monitor |
| `/admin/reports` | Usage reports |
| `/admin/login-history` | Login audit |
| `/admin/announcements` | Broadcast announcements |
| `/admin/user-activity` | Per-user send audit (2-day retention) |
| `/admin/trust-tiers` | Client trust tier, daily limits, tier history |

Nav: `src/components/admin/admin-shell.tsx`

---

## Email sending pipeline

1. Client creates campaign → `POST /api/campaigns` (recipients in JSONB, attachments inline base64).
2. Send → `POST /api/campaigns/[id]/send` → resolves mode (`src/lib/queue/send-mode.ts`):
   - **queue** — Redis up + worker heartbeat → BullMQ job
   - **sync** — no worker, ≤ `MAX_SYNC_RECIPIENTS` (default **5000**)
   - **blocked** — large campaign without worker
3. Worker runs `runSendCampaign()` → `deliverCampaignInParallel()` per SMTP account.
4. Logs → `sending_logs`; campaign status → `completed` / `failed` / `paused` / `cancelled`.
5. On finish → `captureUserActivityBatch()` for admin User Activity (2-day TTL).

---

## Concurrency & limits (defaults)

| Setting | PM2 default | Env var |
|---------|-------------|---------|
| Max active campaigns | **6** | `EMAIL_CAMPAIGN_CONCURRENCY` |
| BullMQ worker jobs | **6** | `EMAIL_WORKER_CONCURRENCY` |
| Global parallel SMTP ops | **36** | `GLOBAL_SMTP_CONCURRENCY` |
| Per-SMTP parallel sends | **6** | `SMTP_WORKER_CONCURRENCY` |
| Sync fallback max recipients | **5000** | `MAX_SYNC_RECIPIENTS` |
| Max recipients / campaign | **50,000** | validation |
| Max attachments | **5 × 3 MB** | `campaign-multipart.ts` |
| HTML render concurrency | **4** | `HTML_RENDER_CONCURRENCY` |
| PM2 memory restart | **900M** | `ecosystem.config.cjs` |
| IP rotation burst (default) | **1000** sends | `user_outbound_ip.rotation_threshold` |

**Capacity notes:**
- **One 5k–6k batch:** supported with worker + Redis.
- **10–12 × 5k parallel:** **not** on default settings (only 6 active); queue the rest or tune env + upgrade VPS.
- **SendGrid/provider rate limits** usually bite before app limits.

Governor: `src/lib/send-governor.ts` — disable with `SEND_GOVERNOR_DISABLE=1` (not recommended prod).

---

## Database (Supabase)

**Core tables:** `profiles`, `campaigns`, `sending_logs`, `smtp_servers`, `credits`, `active_plans`, `unsubscribes`, `login_events`, `announcements`

**Trust / anti-spam audit:**
- `profiles.trust_tier`, `profiles.trust_daily_send_limit` — per-client caps
- `client_trust_tier_history` — tier upgrades/downgrades
- `content_rejection_audit`, `attachment_block_audit`, `content_rescore_audit`

**User activity (2-day retention):**
- `user_activity_batches` — PK `campaign_id`
- `user_activity_snapshots` — body + attachments + sample recipient
- `user_activity_recipients` — per-recipient log copy  
- Purge: `npm run purge-user-activity` + hourly via `site-watchdog.sh`

**Migrations:** `supabase/migrations/*.sql` → `npm run db:migrate`

**RLS:** clients see own rows; admins via `is_admin(auth.uid())`.

---

## Environment variables (production cheat sheet)

| Variable | Purpose |
|----------|---------|
| `NEXT_PUBLIC_SUPABASE_URL` / `ANON_KEY` | Client + server Supabase |
| `SUPABASE_SERVICE_ROLE_KEY` | Worker, admin bootstrap, purge scripts |
| `REDIS_URL` | BullMQ queue (required for reliable bulk) |
| `SMTP_ENCRYPTION_KEY` | Encrypt SMTP passwords at rest |
| `SENDGRID_API_KEY` | Admin dashboard quota (`/v3/user/credits`) |
| `SENDGRID_EMAIL_PLAN_LIMIT` | Optional override for plan allotment (e.g. `50000`); auto ÷10 from API cap if unset |
| `APP_PUBLIC_URL` / `NEXT_PUBLIC_APP_URL` | Unsubscribe links, mailer URLs |
| `PUPPETEER_EXECUTABLE_PATH` | `/usr/bin/chromium` on VPS for PDF attachments |
| `EMAIL_WEBHOOK_SECRET` | Shared secret for inbound bounce/spam webhooks (`X-Webhook-Secret` header) |
| `RECIPIENT_MX_CACHE_TTL_HOURS` | Optional MX DNS cache TTL (default 168h) |
| `DELIVERABILITY_PAUSE_HOURS` | Hours to freeze all sends after reputation spike (default `7`) |
| `DELIVERABILITY_GUARD_DISABLE` | Set `1` to disable auto-freeze guard |
| `DELIVERABILITY_SIGNAL_WINDOW_MINUTES` | Rolling window for spike detection (default `60`) |
| `DELIVERABILITY_COMPOSITE_THRESHOLD` | Weighted score that triggers 7h freeze (default `12`) |
| `DELIVERABILITY_SPAM_REPORT_THRESHOLD` | Spam reports before freeze (default `1`) |
| `DELIVERABILITY_ESP_ACCOUNT_RISK_THRESHOLD` | ESP suspension SMTP errors before freeze (default `1`) |
| `DELIVERABILITY_BLOCKED_THRESHOLD` | Blocked events before freeze (default `2`) |
| `DELIVERABILITY_HARD_BOUNCE_THRESHOLD` | Hard bounces before freeze (default `5`) |
| `DELIVERABILITY_SMTP_SPAM_REJECT_THRESHOLD` | SMTP spam rejects before freeze (default `2`) |
| `GEMINI_API_KEY` | Google AI Studio key for spam-risk content rewrites (free tier) |
| `GEMINI_CONTENT_REVIEW_MODEL` | Optional Gemini model (default `gemini-2.5-flash`; falls back if 404) |
| `CONTENT_MIN_WORD_COUNT` | Min HTML body words (default `25`) |
| `CONTENT_MIN_TEXT_CHARS_PER_ATTACHMENT_KB` | Body text vs attachment size ratio |
| `CONTENT_RESCORE_MAX_ATTEMPTS` | Max spam rescoring attempts per fingerprint window |
| `CONTENT_RESCORE_WINDOW_MINUTES` | Rescore rate-limit window (default `30`) |
| `CONTENT_SPAM_BLOCK_HIGH_RISK` | Block send on high heuristic spam risk (default on; set `0` to disable) |
| `CONTENT_SPAM_BLOCK_MEDIUM_RISK` | Block send on medium risk (default off) |
| `CONTENT_GENUINENESS_GATE_DISABLE` | Set `1` to disable hard genuineness Send gate |
| `GENUINENESS_MIN_SPECIFIC_TOKENS` | Min distinct content tokens in body (default `8`) |
| `GENUINENESS_ATTACHMENT_RELEVANCE_MIN` | Min body↔attachment token overlap (default `0.08`) |
| `GENUINENESS_PASS_TOKEN_TTL_MINUTES` | Pass token lifetime (default `60`) |
| `CAMPAIGN_BOUNCE_PAUSE_RATE` | In-flight campaign hard-bounce rate pause threshold (default `0.05`) |
| `CAMPAIGN_BOUNCE_PAUSE_MIN_ATTEMPTS` | Min attempts before bounce pause (default `20`) |
| `TRUST_TIER_NEW_DAILY_LIMIT` | Daily cap for new tier (default `30`) |
| `TRUST_TIER_ESTABLISHED_DAILY_LIMIT` | Daily cap when established (default `50000`) |
| `TRUST_TIER_RESTRICTED_DAILY_LIMIT` | Daily cap when restricted (default `5`) |

Full list: `.env.example`

**Legacy (unused on dashboard):** `BREVO_API_KEY`, `BREVO_EMAIL_PLAN_LIMIT`

---

## SendGrid SMTP (client settings)

| Field | Value |
|-------|--------|
| Host | `smtp.sendgrid.net` |
| Port | **587** (not 25 on Lightsail) |
| Username | `apikey` |
| Password | SendGrid API key `SG.…` |
| From | Verified domain e.g. `noreply@mailshooter.in` |

From resolution: `src/lib/smtp/from-address.ts` (Mailjet, SendGrid, Brevo host detection).

---

## Deliverability / DNS (mailshooter.in)

- SPF: `v=spf1 include:sendgrid.net ~all` (merge providers if multi-relay)
- SendGrid DKIM + domain authentication in Twilio console for `mailshooter.in`
- DMARC recommended
- Warm-up: start 20–50/day on new domain; UI mentions ~5k/day guidance

Scripts: `scripts/setup-mailshooter-lightsail.sh`

---

## API endpoints (non-exhaustive)

| Endpoint | Notes |
|----------|-------|
| `GET /api/health` | `sendReady`, Redis, worker, circuit breakers |
| `POST /api/campaigns` | Create campaign |
| `POST /api/campaigns/[id]/send` | Start send |
| `POST /api/campaigns/[id]/resume` | Resume paused |
| `POST /api/campaigns/[id]/cancel` | Cancel |
| `GET /api/account/trust-tier` | Client trust tier + daily quota |
| `GET /api/admin/user-activity/attachment` | Admin PDF/image stream (inline preview) |

---

## User Activity feature

- **Route:** `/admin/user-activity`
- **Retention:** 48 hours from `sent_at`; cascade delete snapshots/recipients
- **Capture:** `src/lib/user-activity-capture.ts` on campaign completion
- **PDF preview:** fetch → blob URL in iframe (CSP allows `frame-src blob:`); API route for attachment bytes
- **HTML attachments:** stored as `html_attachment` in snapshot; rendered via Puppeteer on demand

---

## Common issues & fixes

| Symptom | Check |
|---------|--------|
| 502 / site down | `bash scripts/site-watchdog.sh`, `pm2 restart mymail-web` |
| Campaigns stuck queued | Redis? `pm2 logs mymail-worker`, `/api/health` |
| Sends fail 550 From | `from-address.ts` + verified SendGrid sender |
| PDF preview broken | Chromium on server, CSP, attachment API auth |
| Large send OOM | Lower concurrency; disable per-recipient PDF; add swap / upgrade RAM |
| Dashboard quota empty | Set `SENDGRID_API_KEY` in `.env.local`, redeploy |

---

## Agent maintenance rules

When you change the project, **update this file in the same PR/commit** if any of these change:

- New admin/client routes or major features
- Env vars, deploy steps, PM2 defaults
- Sending limits, queue behavior, retention policies
- Production domain, branding, primary email provider
- New migrations or important tables

**Do not** paste secrets (API keys, service role) into this file.

**Read order for new tasks:**
1. `brain.md` (this file)
2. `AGENTS.md` (Next.js + brain rules)
3. Targeted file reads only — avoid full-repo scans unless brain is stale

---

## Related docs

- `README.md` — local dev setup
- `.env.example` — env template
- `CLAUDE.md` → points to `AGENTS.md`
