# BulkProFire — Project Brain

> **Purpose:** Single source of truth for AI agents and developers. Read this file **before** scanning the whole repo.  
> **Maintainers:** Update this file whenever you add features, change limits, deploy steps, or infra — same as you would commit code.  
> **Last updated:** 2026-08-02

---

## Changelog (recent)

| Date | Change |
|------|--------|
| 2026-08-02 | Created `brain.md`; agent rules in `AGENTS.md` |
| 2026-08-03 | SendGrid quota: show plan limit (50K) not 10× API cap; used from stats API |
| 2026-07-30 | **User Activity** admin section (`/admin/user-activity`), 2-day retention, PDF preview via API |
| 2026-07 | SendGrid/Mailjet From-address fixes; brand → `bulkprofire.com` / BulkProFire |

---

## Product at a glance

| Item | Value |
|------|--------|
| **Brand** | BulkProFire |
| **Domain** | `bulkprofire.com` |
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

# Deploy (pull + build + PM2 reload)
git pull && bash scripts/deploy-production.sh

# DB migrations (after pull)
npm run db:migrate

# Health check
curl -sf https://bulkprofire.com/api/health

# PM2
pm2 status
pm2 logs mymail-web --lines 40
pm2 logs mymail-worker --lines 40

# Stack (Redis + web + worker)
bash scripts/ensure-email-stack.sh
```

**Processes (PM2):** `mymail-web`, `mymail-worker` — see `ecosystem.config.cjs`

**Reliability:** `scripts/site-watchdog.sh` (cron every minute), hourly user-activity purge stamp

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
| From | Verified domain e.g. `noreply@bulkprofire.com` |

From resolution: `src/lib/smtp/from-address.ts` (Mailjet, SendGrid, Brevo host detection).

---

## Deliverability / DNS (bulkprofire.com)

- SPF: `v=spf1 include:sendgrid.net ~all` (merge providers if multi-relay)
- SendGrid DKIM + domain authentication in Twilio console
- DMARC recommended
- Warm-up: start 20–50/day on new domain; UI mentions ~5k/day guidance

Scripts: `scripts/fix-bulkprofire-deliverability.sh`

---

## API endpoints (non-exhaustive)

| Endpoint | Notes |
|----------|-------|
| `GET /api/health` | `sendReady`, Redis, worker, circuit breakers |
| `POST /api/campaigns` | Create campaign |
| `POST /api/campaigns/[id]/send` | Start send |
| `POST /api/campaigns/[id]/resume` | Resume paused |
| `POST /api/campaigns/[id]/cancel` | Cancel |
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
